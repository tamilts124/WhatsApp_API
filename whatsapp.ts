import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    type WASocket,
    type Contact
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import { pino } from 'pino';

let sock: WASocket | undefined;
let contacts: Record<string, any> = {};
let currentQr: string | null = null;
let messagesCache: Record<string, any[]> = {}; 
let syncProgress: number = 0;
let isConnecting = false;
let isLoggingOut = false;

const CONTACTS_FILE = './contacts.json';
const MESSAGES_FILE = './messages.json';

// Load contacts from file on startup
if (fs.existsSync(CONTACTS_FILE)) {
    try {
        const savedData = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf-8'));
        if (savedData.contacts) {
            contacts = savedData.contacts;
            syncProgress = savedData.syncProgress || 0;
        } else {
            contacts = savedData;
            syncProgress = Object.keys(contacts).length > 0 ? 100 : 0;
        }
        console.log(`Loaded ${Object.keys(contacts).length} contacts from cache (Sync: ${syncProgress}%)`);
    } catch (e) {
        contacts = {};
    }
}

// Load messages from file on startup
if (fs.existsSync(MESSAGES_FILE)) {
    try {
        messagesCache = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    } catch (e) {
        messagesCache = {};
    }
}

const saveContacts = () => {
    if (isLoggingOut) return;
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify({ syncProgress, contacts }, null, 2));
};

const saveMessages = () => {
    if (isLoggingOut) return;
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesCache, null, 2));
};

export async function connectToWhatsApp(): Promise<WASocket> {
    if (isConnecting || isLoggingOut) {
        if (sock) return sock;
        // If no sock but connecting, wait a bit or just return current (which is undefined)
        return sock as any; 
    }

    isConnecting = true;
    console.log('Connecting to WhatsApp...');

    try {
        if (sock) {
            try {
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
                sock.end(undefined);
            } catch (e) {}
            sock = undefined;
        }

        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }) as any),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }) as any,
            getMessage: async (key) => {
                const jid = key.remoteJid;
                if (jid && messagesCache[jid]) {
                    const msg = messagesCache[jid].find(m => m.key.id === key.id);
                    return msg?.message || undefined;
                }
                return undefined;
            }
        });

        sock.ev.process(async (events) => {
            if (events['connection.update']) {
                const update = events['connection.update'];
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) currentQr = qr;

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    console.log(`Connection closed (Reason: ${statusCode}). Reconnecting: ${shouldReconnect}`);
                    
                    if (shouldReconnect && !isLoggingOut) {
                        connectToWhatsApp();
                    } else if (statusCode === DisconnectReason.loggedOut) {
                        console.log('Logged out detected from server. Clearing session...');
                        logout();
                    }
                } else if (connection === 'open') {
                    console.log('WhatsApp connection opened successfully!');
                    currentQr = null;
                }
            }

        if (events['creds.update']) {
            await saveCreds();
        }

        const historyEvent = events['messaging-history.set'];
        if (historyEvent) {
            const { contacts: newContacts, chats: newChats, messages: newMessages, progress, syncType } = historyEvent;
            console.log(`History Sync Event: Type=${syncType}, Progress=${progress || 0}%`);
            
            if (newContacts) {
                newContacts.forEach(c => {
                    if (c.id.includes('broadcast') || c.id.includes('newsletter')) return;
                    contacts[c.id] = { ...(contacts[c.id] || {}), ...c };
                });
            }
            
            if (newChats) {
                newChats.forEach(chat => {
                    if (chat.id && !contacts[chat.id]) {
                        if (chat.id.includes('broadcast') || chat.id.includes('newsletter')) return;
                        const { id, ...rest } = chat;
                        contacts[id] = { id, ...rest };
                    }
                });
            }

            if (newMessages) {
                newMessages.forEach(msg => {
                    const jid = msg.key.remoteJid;
                    if (jid) {
                        if (!messagesCache[jid]) messagesCache[jid] = [];
                        if (!messagesCache[jid].find(m => m.key.id === msg.key.id)) {
                            messagesCache[jid].push(msg);
                        }
                        if (messagesCache[jid].length > 50) messagesCache[jid].shift();
                        
                        if (contacts[jid]) {
                            const ts = (msg.messageTimestamp as number) || 0;
                            if (!contacts[jid].lastMessageTimestamp || ts > contacts[jid].lastMessageTimestamp) {
                                contacts[jid].lastMessageTimestamp = ts;
                            }
                        }
                    }
                });
            }
            syncProgress = progress || 100;
            saveContacts();
            saveMessages();
        }

        // LID-PN Mapping Updates (New in v7)
        if (events['lid-mapping.update']) {
            const mappings = Array.isArray(events['lid-mapping.update']) ? events['lid-mapping.update'] : [events['lid-mapping.update']];
            for (const { lid, pn } of mappings) {
                if (lid && pn) {
                    console.log(`LID Sync: Mapping ${lid} to ${pn}`);
                    if (contacts[lid]) contacts[lid].phoneNumber = pn;
                    else contacts[lid] = { id: lid, phoneNumber: pn };
                }
            }
            saveContacts();
        }

        if (events['messages.update']) {
            for (const { key, update } of events['messages.update']) {
                const jid = key.remoteJid;
                if (jid && messagesCache[jid]) {
                    const msgIndex = messagesCache[jid].findIndex(m => m.key.id === key.id);
                    if (msgIndex > -1) messagesCache[jid][msgIndex] = { ...messagesCache[jid][msgIndex], ...update };
                }
            }
            saveMessages();
        }

        if (events['messages.upsert']) {
            const { messages: newMessages } = events['messages.upsert'];
            for (const msg of newMessages) {
                const jid = msg.key.remoteJid;
                if (jid) {
                    if (jid.includes('broadcast') || jid.includes('newsletter')) continue;
                    
                    if (!contacts[jid]) contacts[jid] = { id: jid };
                    const pushName = (jid === jidNormalizedUser(sock?.user?.id || '')) ? 'Me (You)' : msg.pushName;
                    if (pushName && !contacts[jid].name) contacts[jid].name = pushName;

                    // Capture LID mapping from alt keys
                    if (jid.includes('@lid') && msg.key.remoteJidAlt) {
                        contacts[jid].phoneNumber = msg.key.remoteJidAlt;
                    }
                    if (msg.key.participant?.includes('@lid') && msg.key.participantAlt) {
                        const pLid = msg.key.participant;
                        if (!contacts[pLid]) contacts[pLid] = { id: pLid };
                        contacts[pLid].phoneNumber = msg.key.participantAlt;
                    }

                    const ts = (msg.messageTimestamp as number) || 0;
                    if (!contacts[jid].lastMessageTimestamp || ts > contacts[jid].lastMessageTimestamp) {
                        contacts[jid].lastMessageTimestamp = ts;
                    }

                    if (!messagesCache[jid]) messagesCache[jid] = [];
                    if (!messagesCache[jid].find(m => m.key.id === msg.key.id)) {
                        messagesCache[jid].push(msg);
                        if (messagesCache[jid].length > 50) messagesCache[jid].shift();
                    }
                }
            }
            saveContacts();
            saveMessages();
        }

        if (events['contacts.update']) {
            for (const update of events['contacts.update']) {
                if (update.id && contacts[update.id]) contacts[update.id] = { ...contacts[update.id], ...update };
            }
            saveContacts();
        }

        if (events['contacts.upsert']) {
            for (const c of events['contacts.upsert']) {
                if (c.id && !c.id.includes('broadcast')) contacts[c.id] = { ...(contacts[c.id] || {}), ...c };
            }
            saveContacts();
        }

        if (events['chats.update']) {
            for (const update of events['chats.update']) {
                if (update.id && contacts[update.id]) contacts[update.id] = { ...contacts[update.id], ...update };
            }
            saveContacts();
        }

        if (events['chats.upsert']) {
            events['chats.upsert'].forEach(chat => {
                if (chat.id && !contacts[chat.id]) {
                    if (chat.id.includes('broadcast') || chat.id.includes('newsletter')) return;
                    const { id, ...rest } = chat;
                    contacts[id] = { id, ...rest };
                }
            });
            saveContacts();
        }

        if (events['groups.upsert']) {
            for (const group of events['groups.upsert']) {
                if (group.id && !contacts[group.id]) contacts[group.id] = { name: group.subject, ...group };
            }
            saveContacts();
        }
    });

        return sock;
    } catch (error) {
        console.error('Failed to connect to WhatsApp:', error);
        throw error;
    } finally {
        isConnecting = false;
    }
}

export const getSocket = () => sock;
export const getAllContacts = () => {
    return Object.values(contacts)
        .filter((c: any) => {
            if (c.id.includes('broadcast') || c.id.includes('newsletter')) return false;
            if (c.id.includes('@lid')) return false;
            return true;
        })
        .sort((a: any, b: any) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));
};
export const getQr = () => currentQr;
export const getSyncProgress = () => syncProgress;

export const getMessages = async (jid: string, count: number = 20) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;

    // Find matching @lid entry
    const allContactsArray = Object.values(contacts);
    const lidEntry = allContactsArray.find((c: any) => {
        if (!c.id?.includes('@lid')) return false;
        if (c.phoneNumber === targetJid || c.id === targetJid) return true;
        // Fallback: check if any of the contact's stored messages have the target JID as an alt
        return c.messages?.some((m: any) => 
            m.message?.key?.remoteJidAlt === targetJid || 
            m.message?.key?.participantAlt === targetJid
        );
    }) as any;

    const lidJid = lidEntry?.id;
    const lidMsgs = lidJid ? (messagesCache[lidJid] || []) : [];
    const jidMsgs = messagesCache[targetJid] || [];

    // Tag and merge
    const allMessages = [
        ...lidMsgs.map(m => ({ ...m, _priority: 1 })),
        ...jidMsgs.map(m => ({ ...m, _priority: 0 }))
    ];

    if (allMessages.length === 0) return [];

    // Deduplicate by ID and sort
    const seen = new Set();
    const result = allMessages
        .filter(m => {
            const msgId = m.key?.id;
            if (!msgId || seen.has(msgId)) return false;
            seen.add(msgId);
            return true;
        })
        .sort((a, b) => {
            const timeA = a.messageTimestamp?.low || Number(a.messageTimestamp) || 0;
            const timeB = b.messageTimestamp?.low || Number(b.messageTimestamp) || 0;
            if (timeA !== timeB) return timeA - timeB;
            return (a._priority || 0) - (b._priority || 0); // Tie-breaker
        })
        .map(({ _priority, ...m }) => m);

    return result.slice(-count);
};

export const sendMessage = async (jid: string, message: string, options: any = {}) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { text: message, ...options });
};

export const editMessage = async (jid: string, messageId: string, newText: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { text: newText, edit: { remoteJid: targetJid, fromMe: true, id: messageId } });
};

export const deleteMessage = async (jid: string, messageId: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { delete: { remoteJid: targetJid, fromMe: true, id: messageId } });
};

export const reactToMessage = async (jid: string, messageId: string, reaction: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { react: { text: reaction, key: { remoteJid: targetJid, fromMe: false, id: messageId } } });
};

export const bulkSend = async (phones: string[], message: string, delayMs: number = 2000) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const results = [];
    for (const phone of phones) {
        try {
            const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
            await sock.sendMessage(jid, { text: message });
            results.push({ phone, status: 'success' });
            if (phones.indexOf(phone) < phones.length - 1) await new Promise(r => setTimeout(r, delayMs));
        } catch (e: any) {
            results.push({ phone, status: 'error', error: e.message });
        }
    }
    return results;
};

export const createGroup = async (title: string, participants: string[]) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const jids = participants.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
    return await sock.groupCreate(title, jids);
};

export const updateGroupParticipants = async (groupJid: string, participants: string[], action: 'add' | 'remove' | 'promote' | 'demote') => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const jids = participants.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
    return await sock.groupParticipantsUpdate(groupJid, jids, action);
};

export const getGroupInviteCode = async (groupJid: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    return await sock.groupInviteCode(groupJid);
};

export const getGroupMetadata = async (groupJid: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    return await sock.groupMetadata(groupJid);
};

export const getBlocklist = async () => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    return await sock.fetchBlocklist();
};

export const updateBlockStatus = async (jid: string, action: 'block' | 'unblock') => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.updateBlockStatus(targetJid, action);
};

export const getPrivacySettings = async () => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    return await sock.fetchPrivacySettings(true);
};

export const updatePrivacy = async (type: 'last' | 'contacts' | 'status' | 'groupadd' | 'online' | 'readreceipts', value: any) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    switch (type) {
        case 'last': return await sock.updateLastSeenPrivacy(value);
        case 'contacts': return await sock.updateProfilePicturePrivacy(value);
        case 'status': return await sock.updateStatusPrivacy(value);
        case 'groupadd': return await sock.updateGroupsAddPrivacy(value);
        case 'online': return await sock.updateOnlinePrivacy(value);
        case 'readreceipts': return await sock.updateReadReceiptsPrivacy(value);
        default: throw new Error('Invalid privacy type');
    }
};

export const archiveChat = async (jid: string, archive: boolean = true) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const lastMessages = messagesCache[targetJid]?.slice(-1) || [];
    return await sock.chatModify({ archive, lastMessages }, targetJid);
};

export const muteChat = async (jid: string, mute: number | null = 8 * 60 * 60 * 1000) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const lastMessages = messagesCache[targetJid]?.slice(-1) || [];
    return await sock.chatModify({ mute, lastMessages }, targetJid);
};

export const markChatRead = async (jid: string, read: boolean = true) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const lastMessages = messagesCache[targetJid]?.slice(-1) || [];
    return await sock.chatModify({ markRead: read, lastMessages }, targetJid);
};

export const getBusinessProfile = async (jid: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.getBusinessProfile(targetJid);
};

export const getCatalog = async (jid: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await (sock as any).getCatalog(targetJid);
};

export const getProfilePicture = async (jid: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    try {
        return await sock.profilePictureUrl(targetJid, 'image');
    } catch (e) {
        return null;
    }
};

export const logout = async () => {
    if (isLoggingOut) return;
    isLoggingOut = true;
    
    console.log('LOGOUT: Starting cleanup process...');
    
    try {
        if (sock) {
            console.log('LOGOUT: Closing socket connection...');
            try {
                // Remove listeners to prevent recursive calls during shutdown
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
                
                // Attempt graceful logout if possible
                try {
                    await Promise.race([
                        sock.logout(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Logout timeout')), 5000))
                    ]);
                } catch (e) {
                    console.log('LOGOUT: Graceful logout failed or timed out, forcing close.');
                }
                
                sock.end(undefined);
            } catch (e: any) {
                console.log('LOGOUT: Error during socket cleanup:', e.message);
            }
            sock = undefined;
        }

        // Clear Memory
        console.log('LOGOUT: Clearing memory caches...');
        contacts = {};
        messagesCache = {};
        syncProgress = 0;
        currentQr = null;

        // Delete Disk Data
        const filesToDelete = [
            'auth_info',
            CONTACTS_FILE,
            MESSAGES_FILE,
            './baileys_store.json',
            './baileys_store_multi.json'
        ];

        for (const file of filesToDelete) {
            try {
                if (fs.existsSync(file)) {
                    const stats = fs.statSync(file);
                    if (stats.isDirectory()) {
                        fs.rmSync(file, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(file);
                    }
                    console.log(`LOGOUT: Deleted ${file}`);
                }
            } catch (e: any) {
                console.error(`LOGOUT: Failed to delete ${file}:`, e.message);
            }
        }
        
        console.log('LOGOUT: All history and sessions cleared.');
    } catch (error) {
        console.error('LOGOUT: General error during logout:', error);
    } finally {
        isLoggingOut = false;
        // Restart connection so a new QR is generated immediately
        connectToWhatsApp();
    }
};

export const requestPairingCode = async (phoneNumber: string) => {
    if (!sock) await connectToWhatsApp();
    if (!sock) throw new Error('Socket not initialized');
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    console.log(`Requesting pairing code for: ${cleanPhone}`);
    return await sock.requestPairingCode(cleanPhone);
};

export const fetchOlderMessages = async (jid: string, count: number = 50) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    console.log(`Fetching older history for: ${targetJid}`);
    const messageCount = typeof count === 'number' ? count : parseInt(count as any) || 50;
    return await (sock as any).fetchMessageHistory(targetJid, messageCount, undefined);
};
