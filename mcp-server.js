
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
    
    // On n'autorise que les protocoles web standard (pas de file://, gopher://, ftp:// ou dict://)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error("Protocole non pris en charge. Seuls http: et https: sont autorisés.");
    }

    const hostname = url.hostname.toLowerCase();
    
    // Si l'expérimentation locale est explicitement autorisée, on court-circuite les vérifications
    if (process.env.ALLOW_LOCAL_SCRAPING === 'true') {
      return true;
    }

    // Blocage explicite des noms d'hôte locaux
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    
    // Détection des blocs d'adresses IP privées (RFC 1918) et de l'IP Link-Local des métadonnées Cloud
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

// Instanciation du serveur MCP
const server = new Server(
  { name: "MelAuFit-mcp-connecteur", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Variables de statut du système exposé aux outils
const statusSysteme = {
  status: "opérationnel",
  version_infra: "1.0.2",
  mode: "local-first"
};

// Chemins locaux de stockage pour les connaissances (RAG) et logs de transaction
const DOSSIER_CONNAISSANCES = path.resolve("./connaissances");
//const FICHIER_TRANSACTIONS = path.resolve("./logs/achats_simules.json"); 

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
      
     // {
       // name: "simuler_action_boutique",
       // description: "OUTIL SENSIBLE. Effectue une action d'achat simulée sur une boutique locale en ligne.",
       // inputSchema: {
         // type: "object",
         // properties: {
          //  item_id: { type: "string", description: "L'identifiant ou le nom du produit à acheter." },
           // quantite: { type: "number", description: "Le nombre d'unités à commander." }
         // },
         // required: ["item_id", "quantite"]
        //}
        
      //},
      
      //{
        //name: "passer_commande_playwright",
        //description: "OUTIL SENSIBLE. Magasine sur la boutique locale en ligne en ouvrant un navigateur réel via Playwright. Il ajoute le produit spécifié au panier, procède au paiement et complète le checkout Stripe de test.",
       // inputSchema: {
          //type: "object",
          //properties: {
           // produit_id: { type: "string", description: "L'identifiant du produit à acheter (ex: casque-tacks, ccm-b45, patins-jetspeed)." },
           //quantite: { type: "number", description: "Le nombre d'unités à commander." },
           // nom: { type: "string", description: "Le nom complet pour la livraison." },
           // adresse: { type: "string", description: "L'adresse complète de livraison." },
           // telephone: { type: "string", description: "Le numéro de téléphone du destinataire." }
          //},
          //required: ["produit_id", "quantite"]
        //}
        
      //}
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

      /* OPTIMISATION : Utilisation du cache RAM pour éviter les lectures disque répétées */
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

      /* CORRECTIF SÉCURITÉ : Validation de l'URL pour empêcher les failles SSRF */
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

 // if (name === "simuler_action_boutique") {
   // try {
     // const { item_id, quantite } = args;

     // if (quantite <= 0) {
       // return { content: [{ type: "text", text: "❌ Erreur : Quantité invalide." }], isError: true };
      //}

      //let transactions = [];
      
      //try {
        //const historique = await fs.readFile(FICHIER_TRANSACTIONS, 'utf-8');
       // transactions = JSON.parse(historique);
     // } catch (err) {
       // transactions = [];
      //}

      //const nouvelleCommande = {
       // id_transaction: `TX-${Math.floor(Math.random() * 90000) + 10000}`,
       // date: new Date().toISOString(),
       // produit: item_id,
       // quantite: quantite,
        //statut: "APPROUVÉ_ET_COMMANDÉ"
      //};

      //transactions.push(nouvelleCommande);
      
      //await fs.writeFile(FICHIER_TRANSACTIONS, JSON.stringify(transactions, null, 2), 'utf-8');

      //return {
       // content: [
         // {
          //  type: "text",
          //  text: `[ACTION RÉUSSIE] La commande a été passée avec succès.\nID Transaction: ${nouvelleCommande.id_transaction}\nProduit: ${nouvelleCommande.produit}\nQuantité: ${nouvelleCommande.quantite}`
         // }
       // ]
      //};

   // } catch (erreur) {
    //  console.error(`[ERREUR TRANSACTION] ${erreur.message}`);
    //  return { content: [{ type: "text", text: `Échec critique de l'action : ${erreur.message}` }], isError: true };
   //}
  //}

  //if (name === "passer_commande_playwright") {
    //let browser;
    //try {
      //const { produit_id, quantite, nom, adresse, telephone } = args;
      //const qte = quantite || 1;
      
      //const estPlaceholder = (val) => {
       // if (!val) return true;
       // const v = val.toLowerCase();
        //return v.includes("nom complet") || v.includes("adresse") || v.includes("téléphone") || v.includes("destinataire");
      //};

      //const clientNom = estPlaceholder(nom) ? "Professeur MelAuFit" : nom;
      //const clientAdresse = estPlaceholder(adresse) ? "123 Rue de la Matrice" : adresse;
      
      //const clientTel = (estPlaceholder(telephone) || !/^\+?[0-9\s\-()]+$/.test(telephone)) ? "5145551234" : telephone;

      //console.error(`[PLAYWRIGHT] Début de l'achat automatisé pour : ${produit_id} (Quantité: ${qte})`);

      //browser = await chromium.launch({ 
       // headless: true,
       // slowMo: 150 
      //});
      
     // const context = await browser.newContext();
      //const page = await context.newPage();
      //await page.setViewportSize({ width: 1920, height: 1080 });

      //const boutiqueUrl = `http://localhost:${process.env.PORT_BOUTIQUE || 8080}`;
      //await page.goto(boutiqueUrl, { waitUntil: 'networkidle' });

      //const productCardSelector = `#card-${produit_id}`;
      //await page.waitForSelector(productCardSelector, { timeout: 5000 });
      //const consultBtn = page.locator(`${productCardSelector} .btn-view`);
      //await consultBtn.click();

      //await page.waitForSelector('#product-modal:not(.hidden)', { timeout: 3000 });
      //const qtyInput = page.locator('#modal-qty');
      //await qtyInput.fill(qte.toString());
      //const addBtn = page.locator('#btn-modal-add');
      //await addBtn.click();

      //await page.waitForSelector('#view-panier:not(.hidden)', { timeout: 3000 });
      //const checkoutBtn = page.locator('#btn-start-checkout');
      //await checkoutBtn.click();

      //await page.waitForSelector('#view-checkout:not(.hidden)', { timeout: 5000 });
      //const stripeFrameLocator = page.frameLocator('#checkout iframe');
      //const emailField = stripeFrameLocator.locator('input#email');
      //await emailField.waitFor({ state: 'visible', timeout: 15000 });

      /* CORRECTIF SÉCURITÉ & CONFIGURATION : Chargement des identifiants et cartes de test Stripe via les variables d'environnement */
      //const stripeEmail = process.env.STRIPE_TEST_EMAIL || 'melaufit@laboratory.ca';
      //const stripeCardNumber = process.env.STRIPE_TEST_CARD_NUMBER || '4242424242424242';
      //const stripeCardExpiry = process.env.STRIPE_TEST_CARD_EXPIRY || '1228';
      //const stripeCardCvc = process.env.STRIPE_TEST_CARD_CVC || '123';

      //await emailField.fill(stripeEmail);
      //await stripeFrameLocator.locator('input#phoneNumber').fill(clientTel);
      //await stripeFrameLocator.locator('input#shippingName').fill(clientNom);
      //await stripeFrameLocator.locator('input#shippingAddressLine1').fill(clientAdresse);
      
      //await stripeFrameLocator.locator('input#shippingLocality').fill('Montréal');
      
      //try {
        //const provSelect = stripeFrameLocator.locator('select#shippingAdministrativeArea');
        //await provSelect.selectOption('QC');
      //} catch (errProv) {
        //try {
          //await stripeFrameLocator.locator('input#shippingAdministrativeArea').fill('QC');
       // } catch (e) {}
      //}

      //await stripeFrameLocator.locator('input#shippingPostalCode').fill('H1A 1A1');
      //await stripeFrameLocator.locator('input#cardNumber').fill(stripeCardNumber);
      //await stripeFrameLocator.locator('input#cardExpiry').fill(stripeCardExpiry);
      //await stripeFrameLocator.locator('input#cardCvc').fill(stripeCardCvc);
      
      //try {
        //await stripeFrameLocator.locator('input#billingName').fill(clientNom);
      //} catch (e) {}

      //const payButton = stripeFrameLocator.getByRole('button', { name: /payer|pay/i });
      //await payButton.click();

      //await page.waitForSelector('#view-success:not(.hidden)', { timeout: 20000 });
      //const txRefText = await page.locator('#success-session-id').textContent();
      //await page.waitForTimeout(3000);
      //await browser.close();

      //return {
        //content: [
          //{
           // type: "text",
           // text: `[ACHAT AUTOMATISÉ RÉUSSI VIA PLAYWRIGHT]\n` +
           //       `Produit commandé : ${produit_id}\n` +
           //       `Quantité : ${qte}\n` +
           //       `Destinataire : ${clientNom}\n` +
           //       `Adresse de livraison : ${clientAdresse}\n` +
           //       `Référence Stripe Session : ${txRefText.trim()}\n` +
            //      `Statut : Commande complétée et payée avec succès !`
          //}
        //]
    //  };
   // } catch (erreur) {
     // console.error(`[ERREUR PLAYWRIGHT] ${erreur.message}`);
     // if (browser) await browser.close();
      //return { content: [{ type: "text", text: `Échec de l'achat automatisé : ${erreur.message}` }], isError: true };
    //}
 // }

  throw new Error(`Outil introuvable : ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[MCP] Serveur de connecteurs complet en ligne (3 outils disponibles)");