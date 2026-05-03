import express, {} from 'express';
import cors from 'cors';
import { z } from 'zod';
import { connectToWhatsApp, getAllContacts, sendMessage, logout, getSocket, getQr, getMessages, bulkSend, getSyncProgress, requestPairingCode, fetchOlderMessages, createGroup, updateGroupParticipants, getGroupInviteCode, getGroupMetadata, getBlocklist, updateBlockStatus, getPrivacySettings, updatePrivacy, archiveChat, muteChat, markChatRead, getBusinessProfile, getCatalog, getProfilePicture } from './whatsapp.js';
const app = express();
const port = 3000;
app.use(express.json());
app.use(cors());
// Initialize WhatsApp connection
connectToWhatsApp();
// Middleware to check if WhatsApp is connected
const checkConnection = (req, res, next) => {
    const sock = getSocket();
    if (!sock || !sock.user) {
        return res.status(503).json({
            status: 'error',
            message: 'WhatsApp is not connected. Please fetch the QR code from the /qr endpoint and scan it.'
        });
    }
    next();
};
// Validation Schemas
const sendSchema = z.object({
    phone: z.string().regex(/^\d+$/, "Phone must be numeric characters only").min(10, "Phone number too short"),
    message: z.string().min(1, "Message cannot be empty").max(4096, "Message too long")
});
const bulkSendSchema = z.object({
    phones: z.array(z.string().regex(/^\d+$/, "Each phone must be numeric")).min(1, "At least one phone number is required"),
    message: z.string().min(1, "Message cannot be empty").max(4096, "Message too long"),
    delayMs: z.number().min(500, "Minimum delay is 500ms").optional()
});
app.get('/business/profile/:jid', async (req, res) => {
    try {
        const profile = await getBusinessProfile(req.params.jid);
        res.json({ status: 'success', profile });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/business/catalog/:jid', async (req, res) => {
    try {
        const catalog = await getCatalog(req.params.jid);
        res.json({ status: 'success', catalog });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/privacy/blocklist', async (req, res) => {
    try {
        const list = await getBlocklist();
        res.json({ status: 'success', blocklist: list });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/privacy/block', async (req, res) => {
    try {
        const { phone, action } = req.body;
        await updateBlockStatus(phone, action);
        res.json({ status: 'success', message: `User ${action}ed successfully` });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/privacy/settings', async (req, res) => {
    try {
        const settings = await getPrivacySettings();
        res.json({ status: 'success', settings });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/privacy/update', async (req, res) => {
    try {
        const { type, value } = req.body;
        await updatePrivacy(type, value);
        res.json({ status: 'success', message: 'Privacy setting updated' });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/groups/create', async (req, res) => {
    try {
        const { title, participants } = req.body;
        if (!title || !participants)
            return res.status(400).json({ status: 'error', message: 'Title and participants are required' });
        const group = await createGroup(title, participants);
        res.json({ status: 'success', group });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/groups/participants', async (req, res) => {
    try {
        const { groupJid, participants, action } = req.body;
        await updateGroupParticipants(groupJid, participants, action);
        res.json({ status: 'success', message: `Participants ${action}ed successfully` });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/groups/invite/:jid', async (req, res) => {
    try {
        const code = await getGroupInviteCode(req.params.jid);
        res.json({ status: 'success', code });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/fetch-history', async (req, res) => {
    try {
        const { phone, count } = req.body;
        if (!phone)
            return res.status(400).json({ status: 'error', message: 'Phone number is required' });
        await fetchOlderMessages(phone, count || 50);
        res.json({ status: 'success', message: 'History fetch requested. New messages will arrive via events.' });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/request-pairing-code', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone)
            return res.status(400).json({ status: 'error', message: 'Phone number is required' });
        const code = await requestPairingCode(phone);
        res.json({ status: 'success', code });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/status', (req, res) => {
    const sock = getSocket();
    const isConnected = !!sock?.user;
    const allContacts = getAllContacts();
    console.log(`Status Check: Connected=${isConnected}, Contacts=${allContacts.length}`);
    res.json({
        status: 'success',
        connected: isConnected,
        user: sock?.user || null,
        contactsCount: allContacts.length,
        syncProgress: getSyncProgress()
    });
});
app.get('/qr', (req, res) => {
    const qr = getQr();
    const sock = getSocket();
    if (sock?.user) {
        return res.json({
            status: 'success',
            message: 'Already connected',
            connected: true
        });
    }
    if (!qr) {
        return res.status(404).json({
            status: 'error',
            message: 'QR code not generated yet. Please wait a few seconds.'
        });
    }
    res.json({
        status: 'success',
        qr: qr
    });
});
app.get('/contacts', checkConnection, (req, res) => {
    try {
        const contacts = getAllContacts();
        res.json({
            status: 'success',
            count: contacts.length,
            contacts: contacts
        });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/contacts/profile-picture/:jid', checkConnection, async (req, res) => {
    try {
        const url = await getProfilePicture(req?.params?.jid);
        res.json({ status: 'success', url });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/messages/:phone', checkConnection, async (req, res) => {
    try {
        const phone = req.params.phone;
        const jidParam = req.query.jid;
        const jid = typeof jidParam === 'string' ? jidParam : phone;
        const queryCount = req.query.count;
        let count = 20;
        if (typeof queryCount === 'string') {
            count = parseInt(queryCount);
        }
        // Validation: allow phone number OR full JID
        if (!jid || (!/^\d+$/.test(jid) && !jid.includes('@'))) {
            return res.status(400).json({ status: 'error', message: 'Invalid phone or JID format' });
        }
        const messages = await getMessages(jid, count);
        console.log(`History Request: Phone=${phone}, Found=${messages.length} messages`);
        res.json({
            status: 'success',
            count: messages.length,
            messages: messages
        });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/send', checkConnection, async (req, res) => {
    try {
        // Validate input
        const validatedData = sendSchema.parse(req.body);
        const result = await sendMessage(validatedData.phone, validatedData.message);
        res.json({
            status: 'success',
            message: `Message sent to ${validatedData.phone}`,
            result
        });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                errors: error.issues
            });
        }
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/bulk-send', checkConnection, async (req, res) => {
    try {
        const validated = bulkSendSchema.parse(req.body);
        const results = await bulkSend(validated.phones, validated.message, validated.delayMs);
        res.json({
            status: 'success',
            results: results
        });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ status: 'error', errors: error.issues });
        }
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/logout', checkConnection, async (req, res) => {
    try {
        await logout();
        res.json({ status: 'success', message: 'Logged out successfully' });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
// Error handler for JSON parsing issues
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
        return res.status(400).json({ status: 'error', message: 'Invalid JSON payload' });
    }
    next();
});
app.listen(port, () => {
    console.log(`WhatsApp API Server running at http://localhost:${port}`);
});
//# sourceMappingURL=server.js.map