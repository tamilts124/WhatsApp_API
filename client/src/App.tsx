import { useState, useEffect } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Send, 
  Users, 
  Activity, 
  LogOut, 
  MessageSquare, 
  RefreshCw,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import './App.css';

const API_BASE = 'http://localhost:3000';

interface Contact {
  id: string;
  name?: string;
  notify?: string;
}

function App() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [phone, setPhone] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const fetchStatus = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/status`);
      setIsConnected(data.connected);
      if (!data.connected) {
        fetchQr();
      } else {
        fetchContacts();
      }
    } catch (error) {
      console.error('Failed to fetch status', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchQr = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/qr`);
      if (data.status === 'success' && data.qr) {
        setQrCode(data.qr);
      }
    } catch (error) {
      console.error('Failed to fetch QR', error);
    }
  };

  const fetchContacts = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/contacts`);
      if (data.status === 'success') {
        setContacts(data.contacts);
      }
    } catch (error) {
      console.error('Failed to fetch contacts', error);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setStatusMsg(null);
    try {
      await axios.post(`${API_BASE}/send`, { phone, message });
      setStatusMsg({ type: 'success', text: 'Message sent successfully!' });
      setMessage('');
    } catch (error: any) {
      setStatusMsg({ 
        type: 'error', 
        text: error.response?.data?.message || 'Failed to send message' 
      });
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to logout?')) return;
    try {
      await axios.post(`${API_BASE}/logout`);
      setIsConnected(false);
      setContacts([]);
      fetchQr();
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (!isConnected) {
        fetchStatus();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isConnected]);

  if (loading) {
    return (
      <div className="main-content">
        <div className="loading-spinner"></div>
        <p style={{ marginTop: '1rem' }}>Connecting to API...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="title">
          <MessageSquare size={24} color="#22c55e" />
          WhatsApp API
        </div>

        <div className={`status-badge ${isConnected ? 'status-online' : 'status-offline'}`}>
          {isConnected ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>

        {isConnected && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="label" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={16} /> Contacts ({contacts.length})
            </div>
            <div className="contact-list">
              {contacts.map(contact => (
                <div key={contact.id} className="contact-item" onClick={() => setPhone(contact.id.split('@')[0])}>
                  <div style={{ backgroundColor: '#334155', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>
                    {(contact.name || contact.notify || 'U')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{contact.name || contact.notify || 'Unknown'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{contact.id.split('@')[0]}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isConnected && (
          <button className="btn btn-danger" onClick={handleLogout}>
            <LogOut size={18} /> Logout
          </button>
        )}
      </div>

      <div className="main-content">
        {!isConnected ? (
          <div className="card">
            <div className="qr-container">
              <h2 style={{ marginBottom: '0.5rem' }}>Link your Account</h2>
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '1.5rem' }}>
                Open WhatsApp on your phone, go to Settings &gt; Linked Devices, and scan the QR code.
              </p>
              <div className="qr-box">
                {qrCode ? (
                  <QRCodeSVG value={qrCode} size={256} />
                ) : (
                  <div className="loading-spinner"></div>
                )}
              </div>
              <button className="btn" onClick={fetchStatus} style={{ marginTop: '1rem', width: 'auto', padding: '0.5rem 1rem' }}>
                <RefreshCw size={16} /> Refresh QR
              </button>
            </div>
          </div>
        ) : (
          <div className="card">
            <h2 className="title"><Send size={20} /> Send Message</h2>
            <form onSubmit={handleSendMessage}>
              <div className="form-group">
                <label className="label">Phone Number (with country code)</label>
                <input 
                  className="input"
                  type="text" 
                  placeholder="e.g. 91995xxxxxxx" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="label">Message</label>
                <textarea 
                  className="textarea"
                  rows={4}
                  placeholder="Type your message here..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                />
              </div>
              
              {statusMsg && (
                <div style={{ 
                  padding: '0.75rem', 
                  borderRadius: '0.5rem', 
                  marginBottom: '1rem',
                  fontSize: '0.875rem',
                  backgroundColor: statusMsg.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: statusMsg.type === 'success' ? '#4ade80' : '#f87171',
                  border: `1px solid ${statusMsg.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
                }}>
                  {statusMsg.text}
                </div>
              )}

              <button className="btn btn-primary" type="submit" disabled={sending}>
                {sending ? <RefreshCw className="animate-spin" size={18} /> : <Send size={18} />}
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
