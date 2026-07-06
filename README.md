# 🔄 Tally Firestore Sync Agent

> A lightweight Node.js service that synchronizes data between **Tally ERP/Prime** and **Google Firestore**, with support for automatic write-back, local checkpointing, and an administrative dashboard.

![Node.js](https://img.shields.io/badge/Node.js-22.x-green)
![Express](https://img.shields.io/badge/Express.js-Backend-black)
![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## 📖 Overview

The **Tally Firestore Sync Agent** acts as a bridge between **Tally ERP/Prime** and **Google Firestore**.

It continuously synchronizes accounting data from Tally to Firestore while maintaining local checkpoints using **LevelDB**. It also supports write-back operations, allowing updates from Firestore to be pushed back into Tally.

---

## ✨ Features

- 🔄 Automatic Tally → Firestore synchronization
- 📤 Firestore → Tally write-back support
- 💾 Local checkpoint storage using LevelDB
- 📊 Admin dashboard for monitoring
- 📄 XML parsing for Tally responses
- ☁️ Firebase Firestore integration
- 📝 Centralized logging
- ⚡ Lightweight Express server
- 🔁 Incremental synchronization

---

## 🏗️ Architecture

```text
                Tally ERP / Prime
                        │
                  XML over HTTP
                        │
                        ▼
        ┌──────────────────────────┐
        │  Tally Sync Agent        │
        │  (Node.js + Express)     │
        └──────────────────────────┘
             │              │
             │              │
             ▼              ▼
      Google Firestore   LevelDB
       (Cloud Storage)  (Local Checkpoints)
             │
             ▼
      Write-back Engine
             │
             ▼
        Tally ERP / Prime
```

---

# 📂 Project Structure

```text
Tally-sync-Agent/

├── src/
│   ├── index.js               # Application entry point
│   ├── firestore.js           # Firestore operations
│   ├── tallyClient.js         # Tally communication
│   ├── pushEngine.js          # Push data to Firestore
│   ├── writebackEngine.js     # Firestore → Tally sync
│   ├── leveldb.js             # Local checkpoint storage
│   ├── normalise.js           # Data normalization
│   ├── logger.js              # Logging utility
│   ├── adminServer.js         # Admin dashboard server
│   └── admin.html             # Dashboard UI
│
├── package.json
├── .gitignore
├── README.md
├── debug-tally.js
└── seed-mock-data.js
```

---

# ⚙️ Technology Stack

### Backend

- Node.js
- Express.js

### Database

- Google Firestore
- LevelDB (Local Storage)

### Parsing

- fast-xml-parser

### Logging

- Winston

### Other Libraries

- Axios
- dotenv
- Firebase Admin SDK

---

# 🚀 Installation

## Clone the repository

```bash
git clone https://github.com/abhijithabhi01/Tally-sync-Agent.git

cd Tally-sync-Agent
```

## Install dependencies

```bash
npm install
```

---

# 🔐 Environment Variables

Create a `.env` file in the project root.

```env
PORT=5000

TALLY_URL=http://localhost:9000

FIREBASE_PROJECT_ID=

GOOGLE_APPLICATION_CREDENTIALS=

COLLECTION_NAME=
```

> Ensure your Firebase service account credentials are configured correctly.

---

# ▶️ Running the Application

Start the development server:

```bash
npm start
```

The service will start and begin synchronizing with Tally.

---

# 🔄 Synchronization Workflow

1. Connect to the Tally HTTP server.
2. Fetch accounting data in XML format.
3. Parse and normalize the XML response.
4. Store synchronization checkpoints in LevelDB.
5. Push processed data to Firestore.
6. Monitor Firestore for write-back requests.
7. Push updates back into Tally.

---

# 📊 Components

| Module | Purpose |
|---------|---------|
| `tallyClient.js` | Communicates with Tally ERP |
| `firestore.js` | Firestore read/write operations |
| `pushEngine.js` | Uploads data to Firestore |
| `writebackEngine.js` | Syncs updates back to Tally |
| `leveldb.js` | Stores local synchronization state |
| `normalise.js` | Cleans and structures data |
| `logger.js` | Application logging |
| `adminServer.js` | Serves admin dashboard |

---

# 🗂️ Local Database

The application uses **LevelDB** to store synchronization checkpoints.

The following directory is created automatically during runtime:

```text
agent-db/
```

This folder contains local database files (`.ldb`, `CURRENT`, `LOCK`, `LOG`, etc.) and **should not be committed to Git**.

Add the following to `.gitignore`:

```gitignore
agent-db/
```

---

# 🔒 Security

- Firebase Admin SDK authentication
- Environment variable configuration
- Local checkpoint storage
- Structured logging
- Input validation

---

# 📝 Logging

Application logs are generated using **Winston** and can be used for troubleshooting synchronization and write-back operations.

---

# 📌 Future Enhancements

- Real-time Firestore listeners
- Retry mechanism for failed synchronizations
- Multi-company support
- Docker deployment
- Synchronization metrics dashboard
- WebSocket-based live monitoring

---

# 👨‍💻 Author

**Abhijith S**

AI Developer | Full Stack Developer

- GitHub: https://github.com/abhijithabhi01
- LinkedIn: https://www.linkedin.com/in/abhijith-s-5138a724b

---

## ⭐ Support

If you found this project useful, please consider giving it a **Star ⭐** on GitHub.
