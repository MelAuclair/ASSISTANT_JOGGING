import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from "@modelcontextprotocol/sdk/types.js";
import { chromium } from 'playwright'; 
import fs from "fs/promises";
import path from "path";
import 'dotenv/config';

let indexConnaissances = null;

/**
 * Charge le fichier de connaissances en mémoire (RAM) pour éviter les lectures disque répétées (cache).
 * Découpe le fichier ligne par ligne pour faciliter la recherche de mots-clés.
 * @param {string} dossierConnaissances - Chemin du dossier des documents locaux.
 * @returns {Promise<Array>} Liste des lignes textuelles du fichier.
 */
async function chargerConnaissancesEnRAM(dossierConnaissances) {
  if (indexConnaissances !== null) return indexConnaissances;
  try {
    const nomFichier = "cours-ia.txt";
    const cheminComplet = path.join(dossierConnaissances, nomFichier);
    const contenuBrut = await fs.readFile(cheminComplet, "utf-8");
    indexConnaissances = contenuBrut.split("\n");
    return indexConnaissances;
  } catch (erreur) {
    return [];
  }
}

/**
 * Valide une URL pour le web scraping afin de prévenir les attaques SSRF (Server-Side Request Forgery).
 * Bloque l'accès aux adresses IP locales et privées (ex: localhost, 127.0.0.1, RFC 1918)
 * sauf si la variable d'environnement ALLOW_LOCAL_SCRAPING=true est définie.
 * @param {string} urlString - L'adresse web à vérifier.
 * @returns {boolean} Retourne true si l'URL est autorisée.
 * @throws {Error} Si le protocole n'est pas http/https ou si l'adresse est jugée non sécurisée.
 */
function validerUrlScraping(urlString) {
  try {
    const url = new URL(urlString);
    
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error("Protocole non pris en charge. Seuls http: et https: sont autorisés.");
    }

    const hostname = url.hostname.toLowerCase();
    
        if (process.env.ALLOW_LOCAL_SCRAPING === 'true') {
      return true;
    }

    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    
    const isPrivateIp = 
      hostname.startsWith('10.') || 
      hostname.startsWith('192.168.') || 
      hostname.startsWith('172.16.') || 
      hostname.startsWith('172.17.') || 
      hostname.startsWith('172.18.') || 
      hostname.startsWith('172.19.') || 
      hostname.startsWith('172.20.') || 
      hostname.startsWith('172.21.') || 
      hostname.startsWith('172.22.') || 
      hostname.startsWith('172.23.') || 
      hostname.startsWith('172.24.') || 
      hostname.startsWith('172.25.') || 
      hostname.startsWith('172.26.') || 
      hostname.startsWith('172.27.') || 
      hostname.startsWith('172.28.') || 
      hostname.startsWith('172.29.') || 
      hostname.startsWith('172.30.') || 
      hostname.startsWith('172.31.') || 
      hostname.startsWith('169.254.');

    if (isLocalhost || isPrivateIp) {
      throw new Error("Accès aux adresses locales et privées interdit en production (SSRF). Activer ALLOW_LOCAL_SCRAPING=true dans le .env pour autoriser.");
    }

    return true;
  } catch (err) {
    throw new Error(`URL invalide ou interdite : ${err.message}`);
  }
}

const server = new Server(
  { name: "MelAuFit-mcp-connecteur", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const statusSysteme = {
  status: "opérationnel",
  version_infra: "1.0.2",
  mode: "local-first"
};

const DOSSIER_CONNAISSANCES = path.resolve("./connaissances");
 
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "verifier_status_systeme",
        description: "Renvoie l'état de santé technique de l'infrastructure locale.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "rechercher_contexte",
        description: "Fouille dans les documents locaux pour extraire des passages pertinents basés sur des mots-clés.",
        inputSchema: {
          type: "object",
          properties: {
            requete: { type: "string", description: "Le mot-clé à rechercher." }
          },
          required: ["requete"]
        }
      },
     {
        name: "extraire_page_web",
        description: "Navigue de manière invisible sur une URL pour en extraire le texte brut textuel.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "L'adresse HTTP complète du site à analyser (ex: https://example.com)." }
          },
          required: ["url"]
        }
      },
      
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "verifier_status_systeme") {
    return {
      content: [{ type: "text", text: `[MCP SERVEUR] Statut: ${statusSysteme.status} | Version: ${statusSysteme.version_infra} | Mode: ${statusSysteme.mode}` }]
    };
  }

  if (name === "rechercher_contexte") {
    try {
      const motCle = args.requete.toLowerCase();

      const lignes = await chargerConnaissancesEnRAM(DOSSIER_CONNAISSANCES);
      const lignesTrouvees = lignes.filter(ligne => ligne.toLowerCase().includes(motCle));

      let reponseTexte = "";
      if (lignesTrouvees.length > 0) {
        reponseTexte = `[RAG LOCAL] Extraits trouvés pour "${args.requete}" :\n\n` + lignesTrouvees.join("\n");
      } else {
        reponseTexte = `[RAG LOCAL] Aucun extrait trouvé pour le terme : "${args.requete}".`;
      }

      return { content: [{ type: "text", text: reponseTexte }] };
    } catch (erreur) {
      return { content: [{ type: "text", text: `[ERREUR RAG] Impossible de lire le fichier de connaissances : ${erreur.message}` }], isError: true };
    }
  }

  if (name === "extraire_page_web") {
    let browser;
    try {
      const targetUrl = args.url;

      validerUrlScraping(targetUrl);

      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      let texteBrut = await page.textContent('body');
      texteBrut = texteBrut.replace(/\s+/g, ' ').trim();
      await browser.close();
      
      return { content: [{ type: "text", text: `[SOURCE WEB: ${targetUrl}]\n\nContenu brut extrait :\n${texteBrut}` }] };
    } catch (erreur) {
      if (browser) await browser.close();
      return { content: [{ type: "text", text: `Impossible d'extraire la page web: ${erreur.message}` }], isError: true };
    }
  }

  throw new Error(`Outil introuvable : ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[MCP] Serveur de connecteurs complet en ligne (3 outils disponibles)");