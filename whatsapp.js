import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, jidNormalizedUser } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import { pino } from 'pino';
let sock;
let contacts = {};
let currentQr = null;
let messagesCache = {};
let syncProgress = 0;
const CONTACTS_FILE = './contacts.json';
const MESSAGES_FILE = './messages.json';
// Load contacts from file on startup
if (fs.existsSync(CONTACTS_FILE)) {
    try {
        const savedData = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf-8'));
        if (savedData.contacts) {
            contacts = savedData.contacts;
            syncProgress = savedData.syncProgress || 0;
        }
        else {
            contacts = savedData;
            syncProgress = Object.keys(contacts).length > 0 ? 100 : 0;
        }
        console.log(`Loaded ${Object.keys(contacts).length} contacts from cache (Sync: ${syncProgress}%)`);
    }
    catch (e) {
        contacts = {};
    }
}
// Load messages from file on startup
if (fs.existsSync(MESSAGES_FILE)) {
    try {
        messagesCache = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    }
    catch (e) {
        messagesCache = {};
    }
}
const saveContacts = () => {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify({ syncProgress, contacts }, null, 2));
};
const saveMessages = () => {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesCache, null, 2));
};
export async function connectToWhatsApp() {
    if (sock) {
        try {
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('creds.update');
            sock.end(undefined);
        }
        catch (e) { }
    }
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
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
            if (qr)
                currentQr = qr;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`Connection closed (Reason: ${statusCode}). Reconnecting: ${shouldReconnect}`);
                if (shouldReconnect) {
                    connectToWhatsApp();
                }
                else {
                    console.log('Logged out. Clearing session...');
                    logout();
                }
            }
            else if (connection === 'open') {
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
                    if (c.id.includes('broadcast') || c.id.includes('newsletter'))
                        return;
                    contacts[c.id] = { ...(contacts[c.id] || {}), ...c };
                });
            }
            if (newChats) {
                newChats.forEach(chat => {
                    if (chat.id && !contacts[chat.id]) {
                        if (chat.id.includes('broadcast') || chat.id.includes('newsletter'))
                            return;
                        const { id, ...rest } = chat;
                        contacts[id] = { id, ...rest };
                    }
                });
            }
            if (newMessages) {
                newMessages.forEach(msg => {
                    const jid = msg.key.remoteJid;
                    if (jid) {
                        if (!messagesCache[jid])
                            messagesCache[jid] = [];
                        if (!messagesCache[jid].find(m => m.key.id === msg.key.id)) {
                            messagesCache[jid].push(msg);
                        }
                        if (messagesCache[jid].length > 50)
                            messagesCache[jid].shift();
                        if (contacts[jid]) {
                            const ts = msg.messageTimestamp || 0;
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
                    if (contacts[lid])
                        contacts[lid].phoneNumber = pn;
                    else
                        contacts[lid] = { id: lid, phoneNumber: pn };
                }
            }
            saveContacts();
        }
        if (events['messages.update']) {
            for (const { key, update } of events['messages.update']) {
                const jid = key.remoteJid;
                if (jid && messagesCache[jid]) {
                    const msgIndex = messagesCache[jid].findIndex(m => m.key.id === key.id);
                    if (msgIndex > -1)
                        messagesCache[jid][msgIndex] = { ...messagesCache[jid][msgIndex], ...update };
                }
            }
            saveMessages();
        }
        if (events['messages.upsert']) {
            const { messages: newMessages } = events['messages.upsert'];
            for (const msg of newMessages) {
                const jid = msg.key.remoteJid;
                if (jid) {
                    if (jid.includes('broadcast') || jid.includes('newsletter'))
                        continue;
                    const normalizedJid = jidNormalizedUser(jid);
                    const isMe = normalizedJid === jidNormalizedUser(sock?.user?.id || '');
                    const pushName = isMe ? 'Me (You)' : msg.pushName;
                    if (contacts[jid]) {
                        if (pushName && !contacts[jid].name)
                            contacts[jid].name = pushName;
                    }
                    else
                        contacts[jid] = { id: jid, name: pushName || undefined };
                    const ts = msg.messageTimestamp || 0;
                    if (!contacts[jid].lastMessageTimestamp || ts > contacts[jid].lastMessageTimestamp) {
                        contacts[jid].lastMessageTimestamp = ts;
                    }
                    if (!messagesCache[jid])
                        messagesCache[jid] = [];
                    if (!messagesCache[jid].find(m => m.key.id === msg.key.id)) {
                        messagesCache[jid].push(msg);
                        if (messagesCache[jid].length > 50)
                            messagesCache[jid].shift();
                    }
                }
            }
            saveContacts();
            saveMessages();
        }
        if (events['contacts.update']) {
            for (const update of events['contacts.update']) {
                if (update.id && contacts[update.id])
                    contacts[update.id] = { ...contacts[update.id], ...update };
            }
            saveContacts();
        }
        if (events['contacts.upsert']) {
            for (const c of events['contacts.upsert']) {
                if (c.id && !c.id.includes('broadcast'))
                    contacts[c.id] = { ...(contacts[c.id] || {}), ...c };
            }
            saveContacts();
        }
        if (events['chats.update']) {
            for (const update of events['chats.update']) {
                if (update.id && contacts[update.id])
                    contacts[update.id] = { ...contacts[update.id], ...update };
            }
            saveContacts();
        }
        if (events['chats.upsert']) {
            events['chats.upsert'].forEach(chat => {
                if (chat.id && !contacts[chat.id]) {
                    if (chat.id.includes('broadcast') || chat.id.includes('newsletter'))
                        return;
                    const { id, ...rest } = chat;
                    contacts[id] = { id, ...rest };
                }
            });
            saveContacts();
        }
        if (events['groups.upsert']) {
            for (const group of events['groups.upsert']) {
                if (group.id && !contacts[group.id])
                    contacts[group.id] = { name: group.subject, ...group };
            }
            saveContacts();
        }
    });
    return sock;
}
export const getSocket = () => sock;
export const getAllContacts = () => {
    return Object.values(contacts)
        .filter((c) => {
        if (c.id.includes('broadcast') || c.id.includes('newsletter'))
            return false;
        if (c.id.includes('@lid') && !c.name && !c.notify && !c.lastMessageTimestamp)
            return false;
        return true;
    })
        .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));
};
export const getQr = () => currentQr;
export const getSyncProgress = () => syncProgress;
export const getMessages = async (jid, count = 20) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const chatMessages = messagesCache[targetJid] || [];
    return chatMessages.slice(-count);
};
export const sendMessage = async (jid, message, options = {}) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { text: message, ...options });
};
export const editMessage = async (jid, messageId, newText) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { text: newText, edit: { remoteJid: targetJid, fromMe: true, id: messageId } });
};
export const deleteMessage = async (jid, messageId) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { delete: { remoteJid: targetJid, fromMe: true, id: messageId } });
};
export const reactToMessage = async (jid, messageId, reaction) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { react: { text: reaction, key: { remoteJid: targetJid, fromMe: false, id: messageId } } });
};
export const bulkSend = async (phones, message, delayMs = 2000) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const results = [];
    for (const phone of phones) {
        try {
            const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
            await sock.sendMessage(jid, { text: message });
            results.push({ phone, status: 'success' });
            if (phones.indexOf(phone) < phones.length - 1)
                await new Promise(r => setTimeout(r, delayMs));
        }
        catch (e) {
            results.push({ phone, status: 'error', error: e.message });
        }
    }
    return results;
};
export const createGroup = async (title, participants) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const jids = participants.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
    return await sock.groupCreate(title, jids);
};
export const updateGroupParticipants = async (groupJid, participants, action) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const jids = participants.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
    return await sock.groupParticipantsUpdate(groupJid, jids, action);
};
export const getGroupInviteCode = async (groupJid) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    return await sock.groupInviteCode(groupJid);
};
export const getGroupMetadata = async (groupJid) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    return await sock.groupMetadata(groupJid);
};
export const getBlocklist = async () => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    return await sock.fetchBlocklist();
};
export const updateBlockStatus = async (jid, action) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.updateBlockStatus(targetJid, action);
};
export const getPrivacySettings = async () => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    return await sock.fetchPrivacySettings(true);
};
export const updatePrivacy = async (type, value) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
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
export const archiveChat = async (jid, archive = true) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const lastMessages = messagesCache[targetJid]?.slice(-1) || [];
    return await sock.chatModify({ archive, lastMessages }, targetJid);
};
export const muteChat = async (jid, mute = 8 * 60 * 60 * 1000) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const lastMessages = messagesCache[targetJid]?.slice(-1) || [];
    return await sock.chatModify({ mute, lastMessages }, targetJid);
};
export const markChatRead = async (jid, read = true) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const lastMessages = messagesCache[targetJid]?.slice(-1) || [];
    return await sock.chatModify({ markRead: read, lastMessages }, targetJid);
};
export const getBusinessProfile = async (jid) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.getBusinessProfile(targetJid);
};
export const getCatalog = async (jid) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.getCatalog(targetJid);
};
export const getProfilePicture = async (jid) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    try {
        return await sock.profilePictureUrl(targetJid, 'image');
    }
    catch (e) {
        return null;
    }
};
export const logout = async () => {
    try {
        if (sock) {
            try {
                await sock.logout();
            }
            catch (e) { }
            try {
                sock.end(undefined);
            }
            catch (e) { }
            sock = undefined;
        }
    }
    catch (e) { }
    if (fs.existsSync('auth_info'))
        try {
            fs.rmSync('auth_info', { recursive: true, force: true });
        }
        catch (e) { }
    if (fs.existsSync(CONTACTS_FILE))
        try {
            fs.unlinkSync(CONTACTS_FILE);
        }
        catch (e) { }
    if (fs.existsSync(MESSAGES_FILE))
        try {
            fs.unlinkSync(MESSAGES_FILE);
        }
        catch (e) { }
    if (fs.existsSync('./baileys_store.json'))
        try {
            fs.unlinkSync('./baileys_store.json');
        }
        catch (e) { }
    contacts = {};
    messagesCache = {};
    syncProgress = 0;
    currentQr = null;
    console.log('Logged out and cleared all session data.');
};
export const requestPairingCode = async (phoneNumber) => {
    if (!sock)
        await connectToWhatsApp();
    if (!sock)
        throw new Error('Socket not initialized');
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    console.log(`Requesting pairing code for: ${cleanPhone}`);
    return await sock.requestPairingCode(cleanPhone);
};
export const fetchOlderMessages = async (jid, count = 50) => {
    if (!sock || !sock.user)
        throw new Error('WhatsApp socket not connected');
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    console.log(`Fetching older history for: ${targetJid}`);
    const messageCount = typeof count === 'number' ? count : parseInt(count) || 50;
    return await sock.fetchMessageHistory(targetJid, messageCount, undefined);
};
//# sourceMappingURL=whatsapp.js.map