# WhatsApp API (Node.js + TypeScript + Baileys)

A high-performance, unofficial WhatsApp API built with Node.js and TypeScript. It uses the `Baileys` library to talk directly to WhatsApp's servers, making it faster and more memory-efficient than browser-based solutions.

## Features
- **TypeScript Support**: Full type safety and modern syntax.
- **Protocol-Based**: No browser needed (Low RAM/CPU).
- **Session Persistence**: Supports existing `creds.json` files.
- **Sync Contacts**: Automatically retrieves all synced contacts.
- **Send Messages**: Fast message delivery to any phone number.
- **Postman Collection**: Pre-configured for easy testing.

## Installation

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Setup Credentials (Optional)**:
   If you have an existing `creds.json` file:
   - Place your `creds.json` file directly in the project root folder.

## Usage

1. **Start the Server**:
   ```bash
   npm start
   ```
   The API will be available at `http://localhost:3000`.

2. **Login**:
   - If you don't have a session, a **QR Code** will appear in your terminal.
   - Scan it with your WhatsApp mobile app.

3. **Check Status**:
   - `GET http://localhost:3000/status`

4. **List Contacts**:
   - `GET http://localhost:3000/contacts`

5. **Send a Message**:
   - `POST http://localhost:3000/send`
   - Body (JSON):
     ```json
     {
       "phone": "1234567890",
       "message": "Hello from TypeScript!"
     }
     ```

6. **Logout**:
   - `POST http://localhost:3000/logout`

## Postman Testing
Import `whatsapp_collection.json` into Postman to start testing the endpoints.

## Disclaimer
This project is for educational purposes only. Automated use of WhatsApp is against their Terms of Service. Use at your own risk.
