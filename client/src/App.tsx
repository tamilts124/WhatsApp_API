import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Send, 
  Users, 
  LogOut, 
  MessageSquare, 
  RefreshCw,
  CheckCircle2,
  XCircle,
  User,
  Plus
} from 'lucide-react';
import './App.css';

const API_BASE = 'http://localhost:3000';

interface Contact {
  id: string;
  name?: string;
  notify?: string;
  lastMessageTimestamp?: number;
  profilePic?: string;
}

// Client-side cache to avoid repeated profile pic fetches
const profilePicCache: Record<string, string> = {};

function App() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [phone, setPhone] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isNewChat, setIsNewChat] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const formatTimestamp = (ts: any): number => {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') return parseInt(ts);
    if (typeof ts.low === 'number') return ts.low; // Handle Long objects
    return 0;
  };

  const scrollToBottom = (force = false) => {
    if (force) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Removed auto-scroll on message change to respect user's scroll position

  const getMessageContent = (msg: any) => {
    if (!msg.message) return '[Empty Message]';
    if (msg.message.conversation) return msg.message.conversation;
    if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
    if (msg.message.imageMessage) return '[Image]';
    if (msg.message.videoMessage) return '[Video]';
    if (msg.message.audioMessage) return '[Audio]';
    if (msg.message.documentMessage) return '[Document]';
    if (msg.message.stickerMessage) return '[Sticker]';
    
    const nested = msg.message.ephemeralMessage?.message || msg.message.viewOnceMessage?.message || msg.message.viewOnceMessageV2?.message;
    if (nested) {
        if (nested.conversation) return nested.conversation;
        if (nested.extendedTextMessage?.text) return nested.extendedTextMessage.text;
    }
    return '[Media/Unsupported]';
  };

  const fetchStatus = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/status`);
      setIsConnected(data.connected);
      if (!data.connected) {
        setQrCode(null);
        fetchQr();
      } else {
        setSyncProgress(data.syncProgress || 0);
      }
    } catch (error) {
      console.error('Failed to fetch status', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchQr = async (retries = 15) => {
    for (let i = 0; i < retries; i++) {
      try {
        const { data } = await axios.get(`${API_BASE}/qr`);
        if (data.connected) { fetchStatus(); return; }
        if (data.status === 'success' && data.qr) { setQrCode(data.qr); return; }
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
  };

  const fetchContacts = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/contacts`);
      if (data.status === 'success') {
        const fetchedContacts = data.contacts.map((c: Contact) => ({
            ...c,
            profilePic: profilePicCache[c.id] || undefined
        }));
        setContacts(fetchedContacts);
        
        // Only fetch if NOT in cache
        fetchedContacts.slice(0, 20).forEach((c: Contact) => {
            if (!profilePicCache[c.id]) fetchProfilePic(c.id);
        });
      }
    } catch (error) {
      console.error('Failed to fetch contacts', error);
    }
  };

  const fetchProfilePic = async (jid: string) => {
    if (profilePicCache[jid]) return; // Redundant double check
    try {
      const { data } = await axios.get(`${API_BASE}/contacts/profile-picture/${jid}`);
      if (data.status === 'success' && data.url) {
        profilePicCache[jid] = data.url;
        setContacts(prev => prev.map(c => c.id === jid ? { ...c, profilePic: data.url } : c));
        if (selectedContact?.id === jid) setSelectedContact(prev => prev ? { ...prev, profilePic: data.url } : null);
      }
    } catch (e) {}
  };

  const fetchMessages = async (contact: Contact, isSilent = false, shouldScroll = false) => {
    if (!isSilent) setLoadingMessages(true);
    try {
      const { data } = await axios.get(`${API_BASE}/messages/${contact.id}`, {
        params: { jid: contact.id, count: 50 }
      });
      if (data.status === 'success') {
        setMessages(data.messages);
        if (shouldScroll) {
          setTimeout(() => scrollToBottom(true), 100);
        }
      }
    } catch (error) {
      console.error('Failed to fetch messages', error);
    } finally {
      if (!isSilent) setLoadingMessages(false);
    }
  };

  const selectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setIsNewChat(false);
    setPhone(contact.id);
    fetchMessages(contact, false, false); // Don't scroll on selection
    if (!profilePicCache[contact.id]) fetchProfilePic(contact.id);
  };

  const startNewChat = () => {
    setSelectedContact(null);
    setIsNewChat(true);
    setPhone('');
    setMessages([]);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setStatusMsg(null);
    try {
      // Format phone: if no @, assume numeric and add suffix
      const formattedPhone = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
      
      await axios.post(`${API_BASE}/send`, { phone: formattedPhone, message });
      setMessage('');
      // Force scroll on send
      if (selectedContact) setTimeout(() => fetchMessages(selectedContact, true, true), 500);
      else if (formattedPhone) {
        const newContact: Contact = { id: formattedPhone };
        setTimeout(() => fetchMessages(newContact, true, true), 500);
      }
    } catch (error: any) {
      setStatusMsg({ type: 'error', text: error.response?.data?.message || 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('Are you sure?')) return;
    try {
      await axios.post(`${API_BASE}/logout`);
      setIsConnected(false);
      setContacts([]);
      setSelectedContact(null);
      // Clear cache on logout
      Object.keys(profilePicCache).forEach(k => delete profilePicCache[k]);
    } catch (e) {}
  };

  useEffect(() => {
    fetchStatus();
    const statusInterval = setInterval(fetchStatus, 10000);
    return () => clearInterval(statusInterval);
  }, []);

  // Fetch contacts exactly once when connection is established
  useEffect(() => {
    if (isConnected && contacts.length === 0) {
      fetchContacts();
    }
  }, [isConnected]);

  // Removed auto-polling for messages to save resources

  const filteredContacts = contacts.filter(c => 
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (c.notify || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.id.includes(searchQuery)
  );

  if (loading) {
    return (
      <div className="main-content center">
        <div className="loading-spinner"></div>
        <p>Initializing WhatsApp...</p>
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

        <div className="status-row">
          <div className={`status-badge ${isConnected ? 'status-online' : 'status-offline'}`}>
            {isConnected ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {isConnected ? 'Connected' : 'Offline'}
          </div>
          {isConnected && syncProgress < 100 && (
            <div className="sync-badge">
              <RefreshCw size={12} className="animate-spin" /> {syncProgress}%
            </div>
          )}
        </div>

        {isConnected && (
          <>
            <div className="sidebar-header-fixed">
              <div className="label-row">
                <span className="label"><Users size={14} /> Contacts</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button className="icon-btn" onClick={fetchContacts} title="Sync Contacts"><RefreshCw size={14} /></button>
                  <button className="icon-btn" onClick={startNewChat} title="New Chat"><Plus size={18} /></button>
                </div>
              </div>
              
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search or start new chat..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="sidebar-scroll">
              <div className="contact-list">
                {filteredContacts.map(c => (
                  <div key={c.id} className={`contact-item ${selectedContact?.id === c.id ? 'active' : ''}`} onClick={() => selectContact(c)}>
                    <div className="avatar">
                      {c.profilePic ? <img src={c.profilePic} alt="" /> : <User size={16} />}
                    </div>
                    <div className="contact-info">
                      <div className="contact-header">
                        <span className="name">{c.name || c.notify || `User ${c.id.split('@')[0]}`}</span>
                        {c.lastMessageTimestamp && <span className="time">{new Date(formatTimestamp(c.lastMessageTimestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                      </div>
                      <div className="jid">{c.id}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {isConnected && <button className="btn btn-danger" onClick={handleLogout}><LogOut size={18} /> Logout</button>}
      </div>

      <div className="main-content">
        {!isConnected ? (
          <div className="card qr-card">
            <h2>Link Device</h2>
            <p>Scan the code from your phone</p>
            <div className="qr-box">
              {qrCode ? <QRCodeSVG value={qrCode} size={256} /> : <div className="loading-spinner"></div>}
            </div>
            <button className="btn" onClick={fetchStatus}><RefreshCw size={16} /> Refresh</button>
          </div>
        ) : (
          <div className="chat-layout">
            <div className="chat-main">
              <div className="chat-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div className="avatar header-avatar">
                        {selectedContact?.profilePic ? <img src={selectedContact.profilePic} alt="" /> : <User size={20} />}
                    </div>
                    <div>
                        <div className="header-name">
                            {isNewChat ? 'New Chat' : (selectedContact?.name || selectedContact?.notify || 'Conversation')}
                        </div>
                        {(selectedContact || isNewChat) && (
                            <div className="header-jid">
                                {isNewChat ? (
                                    <input 
                                        className="header-input" 
                                        placeholder="Enter phone number (e.g. 1234567890)" 
                                        value={phone} 
                                        onChange={(e) => setPhone(e.target.value)}
                                        autoFocus
                                    />
                                ) : selectedContact?.id}
                            </div>
                        )}
                    </div>
                </div>
                {selectedContact && <button className="refresh-btn" title="Reload Messages" onClick={() => fetchMessages(selectedContact, false, false)}><RefreshCw size={16} className={loadingMessages ? 'animate-spin' : ''} /></button>}
              </div>

              <div className="messages-container">
                {!selectedContact && !isNewChat ? (
                  <div className="empty-state">Select a contact or click the plus icon to message a new number</div>
                ) : loadingMessages ? (
                  <div className="empty-state"><div className="loading-spinner"></div></div>
                ) : messages.length === 0 ? (
                  <div className="empty-state">{isNewChat ? 'Type a message to start the conversation' : 'No history found'}</div>
                ) : (
                  messages.map((msg, i) => (
                    <div key={msg.key.id || i} className={`message-row ${msg.key.fromMe ? 'me' : 'them'}`}>
                      <div className="message-bubble">
                        {getMessageContent(msg)}
                        <span className="message-time">{new Date(formatTimestamp(msg.messageTimestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-input">
                {statusMsg && (
                    <div style={{ position: 'absolute', bottom: '80px', left: '20px', right: '20px', padding: '0.5rem', borderRadius: '0.5rem', textAlign: 'center', backgroundColor: statusMsg.type === 'success' ? '#064e3b' : '#7f1d1d', color: 'white', fontSize: '0.75rem', zIndex: 10 }}>
                        {statusMsg.text}
                    </div>
                )}
                <form onSubmit={handleSendMessage}>
                  <input className="input" placeholder="Type a message..." value={message} onChange={(e) => setMessage(e.target.value)} disabled={(!selectedContact && !isNewChat) || sending} />
                  <button className="send-btn" type="submit" disabled={(!selectedContact && !isNewChat) || !message || !phone || sending}>
                    {sending ? <RefreshCw className="animate-spin" size={20} /> : <Send size={20} />}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
