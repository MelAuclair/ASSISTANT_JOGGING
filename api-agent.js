import express from 'express';
import 'dotenv/config';
import fs from 'fs/promises';
import multer from 'multer';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

app.get('/config.js', (req, res) => {
  res.type('javascript');
  res.send(`window.API_SECRET_TOKEN = "${process.env.API_SECRET_TOKEN || ''}";`);
});

const PORT = process.env.PORT || 3000;
const FICHIER_LOG = './logs/agent.log';
const FICHIER_CONVERSATIONS = './logs/conversations.json';

let mcpClient = null;
/**
 * Initialise le client MCP et établit une connexion bidirectionnelle via Stdio
 * avec le serveur local mcp-server.js.
 * @returns {Promise<Client>} Le client MCP connecté.
 */
async function initMcpClient() {
  if (mcpClient) return mcpClient;
  try {
    
    const transport = new StdioClientTransport({
      command: "node",
      args: ["mcp-server.js"]
    });
    const client = new Client(
      { name: "api-agent-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    mcpClient = client;
    console.log("[AJOUT PLAYWRIGHT] Connecté au serveur MCP avec succès.");
    return mcpClient;
  } catch (error) {
    console.error("❌ [AJOUT PLAYWRIGHT] Erreur de connexion au serveur MCP :", error.message);
    throw error;
  }
}

app.use((req, res, next) => {
  const allowedOrigins = ['http://localhost', 'http://127.0.0.1'];
  const origin = req.headers.origin;
  if (origin) {
    const isAllowed = allowedOrigins.some(o => origin.startsWith(o));
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-token');

  if (req.method === 'OPTIONS') return res.sendStatus(200);

  const tokenHeader = req.headers['x-api-token'];
  const secretToken = process.env.API_SECRET_TOKEN;

  if (secretToken && tokenHeader !== secretToken) {
    return res.status(401).json({ erreur: "Non autorisé. Jeton d'API invalide ou manquant." });
  }

  next();
});


let fileQueue = Promise.resolve();

/**
 * Planifie l'exécution d'une opération de fichier (lecture ou écriture) pour qu'elle s'exécute 
 * de manière séquentielle dans la file d'attente globale.
 * @param {Function} op - Fonction asynchrone représentant l'action de lecture/écriture.
 * @returns {Promise} Promesse qui se résout avec le résultat de l'opération ou rejette l'erreur.
 */
async function executerOperationFichier(op) {
  return new Promise((resolve, reject) => {
    // On enchaîne l'action sur la file d'attente existante
    fileQueue = fileQueue.then(async () => {
      try {
        const res = await op();
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function chargerConversations() {
  return executerOperationFichier(async () => {
    try {
      const contenu = await fs.readFile(FICHIER_CONVERSATIONS, 'utf-8');
      return JSON.parse(contenu);
    } catch (err) {
      return {};
    }
  });
}

async function sauvegarderConversations(conversations) {
  return executerOperationFichier(async () => {
    await fs.writeFile(FICHIER_CONVERSATIONS, JSON.stringify(conversations, null, 2), 'utf-8');
  });
}

/**
 * Enregistre un message horodaté dans le fichier de log spécifié.
 * @param {string} chemin - Chemin vers le fichier journal.
 * @param {string} message - Message à journaliser.
 */
async function enregistrerLog(chemin, message) {
  const horodatage = new Date().toISOString();
  await fs.appendFile(chemin, `[${horodatage}] ${message}\n`, 'utf-8');
}

/**
 * Effectue un appel à l'API d'inférence locale d'Ollama avec l'historique complet et les outils MCP.
 * @param {Array} historiqueMessages - Tableau de messages structurés (rôles: user, assistant, system, tool).
 * @param {AbortSignal} signal - Signal d'annulation pour interrompre la requête HTTP.
 * @returns {Promise<Object>} Le message de réponse retourné par Ollama (contenant potentiellement des appels d'outils).
 */

async function chargerConnaissances() {
  const dossier = "./connaissances";
  let connaissances = "";

  try {
    const fichiers = await fs.readdir(dossier);

    for (const fichier of fichiers) {
      const contenu = await fs.readFile(`${dossier}/${fichier}`, "utf-8");
      connaissances += `\n\n### ${fichier}\n${contenu}`;
    }
  } catch (err) {
    console.error("Erreur chargement connaissances:", err.message);
  }

  return connaissances;
}

async function appelerOllama(historiqueMessages, signal, historique = [], message = "") {
  const urlOllama = 'http://localhost:11434/api/chat';
  let toolsOllama = undefined;

  try {
    const client = await initMcpClient();
    const listResponse = await client.listTools();
    if (listResponse.tools && listResponse.tools.length > 0) {
      toolsOllama = listResponse.tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }
      }));
    }
  } catch (err) {
    console.error("⚠️ Impossible de charger les outils MCP pour Ollama:", err.message);
  }

const connaissances = await chargerConnaissances();

  const corpsRequete = {
    model: process.env.MODEL_NAME || "llama3.2:3b",
    messages: [
      {
        role: "system",
        content: `
        Tu es MelAuFit, un coach IA personnel.
        Tu ne commences jamais tes réponses par “assistant”.
        Tu ne t’identifies jamais comme “assistant”.
        Tu réponds directement, comme un coach humain.

        RÈGLE IMPORTANTE — UTILISATION DES CONNAISSANCES

        Tu disposes d'une base de connaissances (météo, vêtements, hydratation, sport, risques)
        qui t'est fournie par le système dans la section "BASE DE CONNAISSANCE".

        Tu n’utilises ces connaissances QUE si l’utilisateur te demande explicitement :
        - un conseil vestimentaire
        - un conseil sportif
        - un conseil santé
        - un conseil hydratation
        - un conseil météo
        - ou une recommandation liée aux conditions extérieures

        Tu réponds normalement, comme un coach qui discute.

        Tu ne donnes jamais de conseils automatiquement.

        BASE DE CONNAISSANCE

        ${connaissances}

        MODULE — ANALYSE DU JOURNAL

        Tu dois répondre aux questions de l'utilisateur en utilisant :
        - son message actuel
        - la météo actuelle (si pertinente)
        - son profil (nom, ville)
        - SON JOURNAL (historique), fourni dans la variable "historique"

        Règles d'analyse du journal :
        - Si l'utilisateur demande : "Ai-je déjà parlé de X ?", tu cherches X dans les entrées.
        - Si l'utilisateur demande : "Comment je me sentais ?", tu résumes les émotions trouvées.
        - Si l'utilisateur demande : "Quels jours j'ai eu de la pluie ?", tu regardes les entrées météo.
        - Si l'utilisateur demande un résumé (jour, semaine, mois), tu fais une synthèse.
        - Si l'utilisateur demande une tendance (fatigue, motivation, humeur), tu analyses les patterns.
        - Si aucune information pertinente n'est trouvée, tu le dis clairement.

        Format de réponse :
        - Clair
        - Structuré
        - Jamais de liste brute du journal
        - Jamais de données privées affichées telles quelles
        - Toujours une réponse utile, basée sur l'historique

        Voici l'historique de l'utilisateur (à analyser, ne jamais afficher brut) :
        ${historique.map(e => `- ${e.date}: ${e.ressenti} (météo: ${e.meteo})`).join("\n")}

        Maintenant, réponds à la question suivante de manière intelligente et personnalisée :
        "${message}"
        `

      },
      ...historiqueMessages
    ],
    stream: false
  };

  if (toolsOllama) {
    corpsRequete.tools = toolsOllama;
  }

  const reponse = await fetch(urlOllama, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpsRequete),
    signal: signal
  });

  if (!reponse.ok) {
    throw new Error(`Ollama a retourné un statut ${reponse.status}`);
  }

  const data = await reponse.json();
  return data.message;
}

/**
 * Extrait le contenu textuel ou l'encodage base64 d'une pièce jointe selon son type MIME.
 * Gère le PDF (pdf-parse), le DOCX/DOC (mammoth), les images et les formats textes ou JSON.
 * @param {Buffer} fileBuffer - Le contenu binaire brut du fichier.
 * @param {string} mimeType - Le type MIME du fichier.
 * @returns {Promise<Object>} Objet contenant le texte extrait et/ou les données image base64.
 */


async function extraireContenuFichier(fileBuffer, mimeType) {
  let documentText = '';
  let imageData = null;

  try {
    if (mimeType.startsWith('image/')) {
      imageData = fileBuffer.toString('base64');
    }
    else if (mimeType.startsWith('text/') ||
             mimeType === 'application/json' ||
             mimeType === 'application/javascript') {
      documentText = fileBuffer.toString('utf-8');
    }
  } catch (err) {
    throw new Error(`Erreur lors de l'extraction du fichier (${mimeType}) : ${err.message}`);
  }

  return { documentText, imageData };
}

function nettoyerTexteIA(texte) {
  if (!texte) return texte;

  texte = texte.replace(/^assistant\s*:/i, "");

  texte = texte.replace(/^assistant\s+/i, "");

  return texte.trim();
}

function enrichirHistorique(messages, fileContext) {
  if (!fileContext) return messages;
  const { documentText, imageData, fileName } = fileContext;

  return messages.map((m) => {
    if (m.role === 'user' && fileName && m.content.includes(`[Fichier joint: ${fileName}]`)) {
      const cleanLabel = `📎 **[Fichier joint: ${fileName}]**\n`;
      const promptText = m.content.startsWith(cleanLabel)
        ? m.content.substring(cleanLabel.length).trim()
        : m.content;

      let content = promptText;
      if (documentText) {
        content = `Contenu du document "${fileName}" :\n"""\n${documentText}\n"""\n\nQuestion / Consigne de l'utilisateur :\n${promptText}`;
      }
      const enriched = { ...m, content };
      if (imageData) {
        enriched.images = [imageData];
      }
      return enriched;
    }
    return m;
  });
}

app.post('/api/chat', upload.single('file'), async (req, res) => {
  const clientController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientController.abort();
    }
  });

  const message = req.body.message || '';
  const meteo = req.body.meteo || null;

  // ⭐⭐ AJOUT OBLIGATOIRE ⭐⭐
  const historique = req.body.historique || [];

  const conversationId = req.body.conversationId;
  const file = req.file;

  if (!message && !file && !req.body.file) {
    return res.status(400).json({ erreur: "Message ou fichier manquant." });
  }

  try {
    let documentText = '';
    let imageData = null;
    let fileName = '';

    if (file) {
      fileName = file.originalname;
      const fileBuffer = await fs.readFile(file.path);
      const result = await extraireContenuFichier(fileBuffer, file.mimetype);
      documentText = result.documentText;
      imageData = result.imageData;

      await fs.unlink(file.path);
    }
    else if (req.body.file) {
      fileName = req.body.file.name;
      const fileBuffer = Buffer.from(req.body.file.buffer, 'base64');
      const result = await extraireContenuFichier(fileBuffer, req.body.file.mimeType);
      documentText = result.documentText;
      imageData = result.imageData;
    }

    const conversations = await chargerConversations();
    const id = conversationId || `conv-${Date.now()}`;

    const userPrompt = message.trim() || (imageData ? "Analyse cette image." : "Analyse ce document.");

    if (!conversations[id]) {
      conversations[id] = {
        id: id,
        titre: fileName ? `Pièce jointe : ${fileName}` : (userPrompt.substring(0, 30) + (userPrompt.length > 30 ? '...' : '')),
        timestamp: new Date().toISOString(),
        messages: []
      };
    }

    let contentForHistory = userPrompt;
    let contentForOllama = userPrompt;

    if (fileName) {
      contentForHistory = `📎 **[Fichier joint: ${fileName}]**\n${userPrompt}`;
    }

    if (documentText) {
      contentForOllama = `Contenu du document "${fileName}" :\n"""\n${documentText}\n"""\n\nQuestion / Consigne de l'utilisateur :\n${userPrompt}`;
    }

    if (fileName) {
      conversations[id].fileContext = { documentText, imageData, fileName };
    }

    conversations[id].messages.push({ role: 'user', content: contentForHistory });
    if (meteo) {
      conversations[id].messages.push({
        role: "system",
        content: `Météo actuelle : ${meteo}`
      });
    }

    conversations[id].timestamp = new Date().toISOString();

    const messageIA = await appelerOllama(
      enrichirHistorique(conversations[id].messages, conversations[id].fileContext),
      clientController.signal,
      historique,   // ⭐ ajouté
      message       // ⭐ ajouté
    );

    if (messageIA.tool_calls && messageIA.tool_calls.length > 0) {
      //const OUTILS_SENSIBLES = ["simuler_action_boutique", "passer_commande_playwright"];
      const aOutilsSensibles = messageIA.tool_calls.some(tc => OUTILS_SENSIBLES.includes(tc.function.name));

      if (aOutilsSensibles) {
        conversations[id].pendingToolCalls = messageIA.tool_calls;
        conversations[id].pendingAssistantMessage = messageIA;
        await sauvegarderConversations(conversations);

        await enregistrerLog(FICHIER_LOG, `HITL_PENDING: Approbation requise pour conv ${id}`);

        return res.json({
          reponse: `⚠️ **[ACTION SENSIBLE - APPROBATION REQUISE]**\nL'agent souhaite exécuter l'action suivante :\n\n` +
            messageIA.tool_calls.map(tc => `🔧 **Outil** : \`${tc.function.name}\`\n📦 **Arguments** : \`${JSON.stringify(tc.function.arguments)}\``).join("\n\n") +
            `\n\nVeuillez autoriser l'action en appuyant sur **'o'** (Oui) ou **'n'** (Non) sur votre clavier.`,
          conversationId: id,
          requiertApprobation: true
        });
      } else {
        conversations[id].messages.push(messageIA);
        const client = await initMcpClient();
        for (const tc of messageIA.tool_calls) {
          await enregistrerLog(FICHIER_LOG, `TOOL_CALL: Exécution automatique de ${tc.function.name}`);
          const resTool = await client.callTool({
            name: tc.function.name,
            arguments: tc.function.arguments
          });
          conversations[id].messages.push({
            role: "tool",
            name: tc.function.name,
            content: typeof resTool.content === 'string' ? resTool.content : JSON.stringify(resTool.content)
          });
        }

        const finalMessage = await appelerOllama(enrichirHistorique(conversations[id].messages, conversations[id].fileContext), clientController.signal);
        conversations[id].messages.push(finalMessage);
        await sauvegarderConversations(conversations);

        return res.json({
          role: "MelAuFit",
          reponse: finalMessage.content,
          conversationId: id,
          titre: conversations[id].titre
        });
      }
    } else {
      conversations[id].messages.push(messageIA);
      await sauvegarderConversations(conversations);
      await enregistrerLog(FICHIER_LOG, `LLM_RESPONSE: Succès. ConvID: ${id}`);

      return res.json({
        role: "MelAuFit",
        reponse: messageIA.content,
        conversationId: id,
        titre: conversations[id].titre
      });
    }

  } catch (erreur) {
    await enregistrerLog(FICHIER_LOG, `LLM_ERROR: Échec : ${erreur.message}`);
    return res.status(500).json({
      reponse: `[! Erreur Cerveau] Impossible de générer une réponse. Ennuis techniques: ${erreur.message}`
    });
  }
});

app.post('/api/chat/approuver', async (req, res) => {
  
  const clientController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientController.abort();
    }
  });

  const { approval, conversationId } = req.body;
  if (!conversationId || !approval) {
    return res.status(400).json({ erreur: "Données manquantes." });
  }

  try {
    const conversations = await chargerConversations();
    const conv = conversations[conversationId];
    if (!conv || !conv.pendingToolCalls) {
      return res.status(400).json({ erreur: "Aucune action en attente d'approbation." });
    }

    const pendingToolCalls = conv.pendingToolCalls;
    const pendingAssistantMessage = conv.pendingAssistantMessage;

    delete conv.pendingToolCalls;
    delete conv.pendingAssistantMessage;

    conv.messages.push(pendingAssistantMessage);

    if (approval === 'o') {
      await enregistrerLog(FICHIER_LOG, `HITL_APPROVED: Action approuvée par l'utilisateur.`);

      const client = await initMcpClient();
      for (const tc of pendingToolCalls) {
        await enregistrerLog(FICHIER_LOG, `TOOL_CALL: Exécution de l'outil sensible ${tc.function.name}`);
        const resTool = await client.callTool({
          name: tc.function.name,
          arguments: tc.function.arguments
        });

        conv.messages.push({
          role: "tool",
          name: tc.function.name,
          content: typeof resTool.content === 'string' ? resTool.content : JSON.stringify(resTool.content)
        });
      }
    } else {
      await enregistrerLog(FICHIER_LOG, `HITL_REJECTED: Action rejetée par l'utilisateur.`);
      for (const tc of pendingToolCalls) {
        conv.messages.push({
          role: "tool",
          name: tc.function.name,
          content: "Action annulée par l'utilisateur : L'approbation humaine physique a été refusée."
        });
      }
    }

    const finalMessage = await appelerOllama(enrichirHistorique(conv.messages, conv.fileContext), clientController.signal);
    conv.messages.push(finalMessage);

    await sauvegarderConversations(conversations);

    return res.json({
      reponse: finalMessage.content,
      conversationId: conversationId,
      titre: conv.titre
    });

  } catch (erreur) {
    await enregistrerLog(FICHIER_LOG, `LLM_ERROR: Échec d'approbation : ${erreur.message}`);
    return res.status(500).json({
      reponse: `[! Erreur Cerveau] Impossible de traiter l'approbation. Ennuis techniques: ${erreur.message}`
    });
  }
});

app.get('/api/conversations', async (req, res) => {
  try {
    const conversations = await chargerConversations();
    const liste = Object.values(conversations)
      .map(c => ({ id: c.id, titre: c.titre, timestamp: c.timestamp }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return res.json(liste);
  } catch (erreur) {
    return res.status(500).json({ erreur: erreur.message });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const conversations = await chargerConversations();
    const conv = conversations[id];
    if (!conv) {
      return res.status(404).json({ erreur: "Conversation introuvable." });
    }
    return res.json(conv);
  } catch (erreur) {
    return res.status(500).json({ erreur: erreur.message });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const conversations = await chargerConversations();
    if (conversations[id]) {
      delete conversations[id];
      await sauvegarderConversations(conversations);
      return res.json({ succes: true });
    }
    return res.status(404).json({ erreur: "Conversation introuvable." });
  } catch (erreur) {
    return res.status(500).json({ erreur: erreur.message });
  }
});

app.get('/api/weather', async (req, res) => {
  try {
    const city = req.query.city || "Drummondville";
    const apiKey = process.env.OPENWEATHER_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Clé OpenWeather manquante dans .env" });
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&lang=fr&appid=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.cod !== 200) {
      return res.status(400).json({ error: "Ville invalide ou API OpenWeather indisponible" });
    }

    return res.json({
      temp: data.main.temp,
      description: data.weather[0].description,
      humidity: data.main.humidity,
      icon: data.weather[0].icon,
      city: data.name
    });

  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur météo : " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[API] Serveur Express connecté à l'inférence locale sur le port ${PORT}`);
});