import fs from 'fs/promises';

/**
 * * Écrit proprement des données textuelles dans un fichier cible (mode append pour les logs)
* @param {string} chemin
* @param {string} contenu
*/
export async function enregistrerLog(chemin, contenu) {
    try {
        const horodatage = new Date().toLocaleString('en-US', { hour12: false});
        const ligneFormatee = `[${horodatage}] ${contenu}\n\r`;
        await fs.appendFile(chemin, ligneFormatee, 'utf-8');
              
    } catch (error) {
        console.error("ERREUR : Impossible d'enregistrer le log.", error);
        throw error;
    }
}