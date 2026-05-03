import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { connectToWhatsApp, getAllContacts, sendMessage, logout, getSocket, getQr } from './whatsapp.js';

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// Initialize WhatsApp connection
connectToWhatsApp();

// Middleware to check if WhatsApp is connected
const checkConnection = (req: Request, res: Response, next: Function) => {
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

app.get('/status', (req: Request, res: Response) => {
    const sock = getSocket();
    const isConnected = !!sock?.user;
    res.json({ 
        status: 'success',
        connected: isConnected, 
        user: sock?.user || null 
    });
});

app.get('/qr', (req: Request, res: Response) => {
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

app.get('/contacts', checkConnection, (req: Request, res: Response) => {
    try {
        const contacts = getAllContacts();
        res.json({
            status: 'success',
            count: contacts.length,
            contacts: contacts
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/send', checkConnection, async (req: Request, res: Response) => {
    try {
        // Validate input
        const validatedData = sendSchema.parse(req.body);
        
        const result = await sendMessage(validatedData.phone, validatedData.message);
        res.json({ 
            status: 'success', 
            message: `Message sent to ${validatedData.phone}`,
            result 
        });
    } catch (error: any) {
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

app.post('/logout', checkConnection, async (req: Request, res: Response) => {
    try {
        await logout();
        res.json({ status: 'success', message: 'Logged out successfully' });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Error handler for JSON parsing issues
app.use((err: any, req: Request, res: Response, next: Function) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
        return res.status(400).json({ status: 'error', message: 'Invalid JSON payload' });
    }
    next();
});

app.listen(port, () => {
    console.log(`WhatsApp API Server running at http://localhost:${port}`);
});
