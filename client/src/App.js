import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { Send, Users, Activity, LogOut, MessageSquare, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import './App.css';
const API_BASE = 'http://localhost:3000';
function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [qrCode, setQrCode] = useState(null);
    const [contacts, setContacts] = useState([]);
    const [selectedContact, setSelectedContact] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [phone, setPhone] = useState('');
    const [message, setMessage] = useState('');
    const [statusMsg, setStatusMsg] = useState(null);
    const fetchStatus = async () => {
        try {
            const { data } = await axios.get(`${API_BASE}/status`);
            setIsConnected(data.connected);
            if (!data.connected) {
                setQrCode(null);
                fetchQr();
            }
            else if (contacts.length === 0) {
                fetchContacts();
            }
        }
        catch (error) {
            console.error('Failed to fetch status', error);
        }
        finally {
            setLoading(false);
        }
    };
    const fetchQr = async () => {
        try {
            const { data } = await axios.get(`${API_BASE}/qr`);
            if (data.status === 'success' && data.qr) {
                setQrCode(data.qr);
            }
        }
        catch (error) {
            console.error('Failed to fetch QR', error);
        }
    };
    const fetchContacts = async () => {
        try {
            const { data } = await axios.get(`${API_BASE}/contacts`);
            if (data.status === 'success') {
                setContacts(data.contacts);
            }
        }
        catch (error) {
            console.error('Failed to fetch contacts', error);
        }
    };
    const fetchMessages = async (contact) => {
        setLoadingMessages(true);
        setSelectedContact(contact);
        setPhone(contact.id.split('@')[0]);
        try {
            const { data } = await axios.get(`${API_BASE}/messages/${contact.id.split('@')[0]}`);
            if (data.status === 'success') {
                setMessages(data.messages);
            }
        }
        catch (error) {
            console.error('Failed to fetch messages', error);
            setMessages([]);
        }
        finally {
            setLoadingMessages(false);
        }
    };
    const handleSendMessage = async (e) => {
        e.preventDefault();
        setSending(true);
        setStatusMsg(null);
        try {
            await axios.post(`${API_BASE}/send`, { phone, message });
            setStatusMsg({ type: 'success', text: 'Message sent successfully!' });
            setMessage('');
            if (selectedContact && phone === selectedContact.id.split('@')[0]) {
                setTimeout(() => fetchMessages(selectedContact), 1000);
            }
        }
        catch (error) {
            setStatusMsg({
                type: 'error',
                text: error.response?.data?.message || 'Failed to send message'
            });
        }
        finally {
            setSending(false);
        }
    };
    const handleLogout = async () => {
        if (!window.confirm('Are you sure you want to logout?'))
            return;
        try {
            await axios.post(`${API_BASE}/logout`);
            setIsConnected(false);
            setContacts([]);
            setSelectedContact(null);
            setMessages([]);
            fetchQr();
        }
        catch (error) {
            console.error('Logout failed', error);
        }
    };
    useEffect(() => {
        fetchStatus();
        const interval = setInterval(() => {
            // Poll if not connected (for QR) OR if connected but contacts haven't loaded yet
            if (!isConnected || (isConnected && contacts.length === 0)) {
                fetchStatus();
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [isConnected, contacts.length]);
    if (loading) {
        return (_jsxs("div", { className: "main-content", children: [_jsx("div", { className: "loading-spinner" }), _jsx("p", { style: { marginTop: '1rem' }, children: "Connecting to API..." })] }));
    }
    return (_jsxs("div", { className: "app-container", children: [_jsxs("div", { className: "sidebar", children: [_jsxs("div", { className: "title", children: [_jsx(MessageSquare, { size: 24, color: "#22c55e" }), "WhatsApp API"] }), _jsxs("div", { className: `status-badge ${isConnected ? 'status-online' : 'status-offline'}`, children: [isConnected ? _jsx(CheckCircle2, { size: 16 }) : _jsx(XCircle, { size: 16 }), isConnected ? 'Connected' : 'Disconnected'] }), isConnected && (_jsxs("div", { style: { flex: 1, overflowY: 'auto' }, children: [_jsxs("div", { className: "label", style: { marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }, children: [_jsx(Users, { size: 16 }), " Contacts (", contacts.length, ")"] }), _jsx("div", { className: "contact-list", children: contacts.map(contact => (_jsxs("div", { className: `contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`, onClick: () => fetchMessages(contact), children: [_jsx("div", { style: { backgroundColor: '#334155', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', fontSize: '0.75rem' }, children: (contact.name || contact.notify || 'U')[0].toUpperCase() }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: { fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: contact.name || contact.notify || 'Unknown' }), _jsx("div", { style: { fontSize: '0.75rem', color: 'var(--text-secondary)' }, children: contact.id.split('@')[0] })] })] }, contact.id))) })] })), isConnected && (_jsxs("button", { className: "btn btn-danger", onClick: handleLogout, children: [_jsx(LogOut, { size: 18 }), " Logout"] }))] }), _jsx("div", { className: "main-content", children: !isConnected ? (_jsx("div", { className: "card", children: _jsxs("div", { className: "qr-container", children: [_jsx("h2", { style: { marginBottom: '0.5rem' }, children: "Link your Account" }), _jsx("p", { style: { color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '1.5rem' }, children: "Open WhatsApp on your phone, go to Settings > Linked Devices, and scan the QR code." }), _jsx("div", { className: "qr-box", children: qrCode ? (_jsx(QRCodeSVG, { value: qrCode, size: 256 })) : (_jsx("div", { className: "loading-spinner" })) }), _jsxs("button", { className: "btn", onClick: fetchStatus, style: { marginTop: '1rem', width: 'auto', padding: '0.5rem 1rem' }, children: [_jsx(RefreshCw, { size: 16 }), " Refresh QR"] })] }) })) : (_jsxs("div", { style: { width: '100%', maxWidth: '900px', display: 'flex', gap: '2rem', height: '100%' }, children: [_jsx("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }, children: _jsxs("div", { className: "card", style: { maxWidth: 'none' }, children: [_jsxs("h2", { className: "title", children: [_jsx(Send, { size: 20 }), " Send Message"] }), _jsxs("form", { onSubmit: handleSendMessage, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { className: "label", children: "Phone Number" }), _jsx("input", { className: "input", type: "text", placeholder: "e.g. 91995xxxxxxx", value: phone, onChange: (e) => setPhone(e.target.value), required: true })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "label", children: "Message" }), _jsx("textarea", { className: "textarea", rows: 3, placeholder: "Type your message here...", value: message, onChange: (e) => setMessage(e.target.value), required: true })] }), statusMsg && (_jsx("div", { style: {
                                                    padding: '0.75rem',
                                                    borderRadius: '0.5rem',
                                                    marginBottom: '1rem',
                                                    fontSize: '0.875rem',
                                                    backgroundColor: statusMsg.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    color: statusMsg.type === 'success' ? '#4ade80' : '#f87171',
                                                    border: `1px solid ${statusMsg.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
                                                }, children: statusMsg.text })), _jsxs("button", { className: "btn btn-primary", type: "submit", disabled: sending, children: [sending ? _jsx(RefreshCw, { className: "animate-spin", size: 18 }) : _jsx(Send, { size: 18 }), sending ? 'Sending...' : 'Send Message'] })] })] }) }), _jsxs("div", { className: "card", style: { flex: 1.5, maxWidth: 'none', display: 'flex', flexDirection: 'column' }, children: [_jsxs("h2", { className: "title", style: { justifyContent: 'space-between' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' }, children: [_jsx(Activity, { size: 20 }), selectedContact ? (selectedContact.name || selectedContact.notify || 'Conversation') : 'Select a contact'] }), selectedContact && (_jsx("button", { className: "btn", style: { width: 'auto', padding: '0.25rem 0.5rem' }, onClick: () => fetchMessages(selectedContact), children: _jsx(RefreshCw, { size: 14, className: loadingMessages ? 'animate-spin' : '' }) }))] }), _jsx("div", { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingRight: '0.5rem' }, children: !selectedContact ? (_jsx("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }, children: "Select a contact from the sidebar to view history" })) : loadingMessages ? (_jsx("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx("div", { className: "loading-spinner" }) })) : messages.length === 0 ? (_jsx("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }, children: "No messages found in memory" })) : (messages.map((msg, i) => {
                                        const isMe = msg.key.fromMe;
                                        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Media/Unsupported]';
                                        return (_jsxs("div", { style: {
                                                alignSelf: isMe ? 'flex-end' : 'flex-start',
                                                maxWidth: '80%',
                                                backgroundColor: isMe ? 'var(--accent-primary)' : 'var(--bg-primary)',
                                                padding: '0.75rem',
                                                borderRadius: '0.75rem',
                                                borderBottomRightRadius: isMe ? '0.125rem' : '0.75rem',
                                                borderBottomLeftRadius: isMe ? '0.75rem' : '0.125rem',
                                                fontSize: '0.875rem',
                                                position: 'relative'
                                            }, children: [text, _jsx("div", { style: { fontSize: '0.625rem', opacity: 0.7, marginTop: '0.25rem', textAlign: 'right' }, children: new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })] }, msg.key.id || i));
                                    })) })] })] })) })] }));
}
export default App;
//# sourceMappingURL=App.js.map