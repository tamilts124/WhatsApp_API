import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    type WASocket,
    type Contact,
    type AuthenticationState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import { pino } from 'pino';

let sock: WASocket | undefined;
let contacts: Record<string, Contact> = {};
let currentQr: string | null = null;

export async function connectToWhatsApp(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }) as any
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            currentQr = qr;
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('opened connection');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Sync contacts
    sock.ev.on('contacts.upsert', (newContacts) => {
        newContacts.forEach(contact => {
            contacts[contact.id] = contact;
        });
    });

    return sock;
}

export const getSocket = () => sock;
export const getAllContacts = () => Object.values(contacts);
export const getQr = () => currentQr;

export const sendMessage = async (jid: string, message: string) => {
    if (!sock || !sock.user) throw new Error('WhatsApp socket not connected');
    
    // Append @s.whatsapp.net if not present
    const targetJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    return await sock.sendMessage(targetJid, { text: message });
};

export const logout = async () => {
    if (!sock) return;
    try {
        await sock.logout();
    } catch (e) {
        console.error('Error during WhatsApp logout', e);
    }
    
    if (fs.existsSync('auth_info')) {
        fs.rmSync('auth_info', { recursive: true, force: true });
    }
    console.log('Logged out and cleared credentials.');
};
