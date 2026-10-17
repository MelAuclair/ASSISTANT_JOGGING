const API_TOKEN = window.API_SECRET_TOKEN;
let currentUser = null;
let meteoActuelle = null;

// Journal permanent (backup par utilisateur)
let journalBackup = {}; // journalBackup[email] = [...]

// RÉFÉRENCES DOM
const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginName = document.getElementById("loginName");
const loginEmail = document.getElementById("loginEmail");
const loginCity = document.getElementById("loginCity");
const chatHistory = document.getElementById("chatHistory");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const journalInput = document.getElementById("journalInput");
const journalBtn = document.getElementById("journalBtn");
const weatherInfo = document.getElementById("weatherInfo");
const healthAdvice = document.getElementById("healthAdvice");
const changeUserBtn = document.getElementById("changeUserBtn");

// Vérifier backend (météo)
async function backendPret() {
  try {
    const res = await fetch("/api/weather", {
      headers: { "x-api-token": API_TOKEN }
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Charger météo
async function chargerMeteo(ville) {
  try {
    const res = await fetch(`/api/weather?city=${ville}`, {
      headers: { "x-api-token": API_TOKEN }
    });

    const data = await res.json();
    meteoActuelle = data;

    weatherInfo.textContent = `Température réelle : ${data.temp}°C à ${data.city}`;
    return data;

  } catch {
    weatherInfo.textContent = "Température réelle : --";
    return null;
  }
}

// Conseils santé
function genererConseils(meteo) {
  if (!meteo) return;

  const t = meteo.temp;
  let conseils = [];

  if (t >= 28) conseils = ["Hydratation fréquente", "Chercher l’ombre"];
  else if (t >= 20) conseils = ["Bonne hydratation", "Tenue légère recommandée"];
  else if (t >= 10) conseils = ["Habille-toi confortablement", "Échauffement recommandé"];
  else conseils = ["Porter des vêtements chauds", "Éviter les longues expositions au froid"];

  healthAdvice.innerHTML = conseils.map(c => `<p>• ${c}</p>`).join("");
}

// Chat IA — maintenant avec interrogation du journal
async function envoyerMessage(message) {
  if (!message.trim()) return;

  chatHistory.innerHTML += `<div class="msg-user">${message}</div>`;

  
  const meteoTexte = meteoActuelle
    ? `Température: ${meteoActuelle.temp}°C, ${meteoActuelle.description}`
    : "Météo indisponible";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": API_TOKEN
      },
      body: JSON.stringify({
        message,
        meteo: meteoTexte,
        user: currentUser,
        historique: journalBackup[currentUser.email] || [] // ⭐ ON ENVOIE L’HISTORIQUE
      })
    });

    const data = await res.json();
    chatHistory.innerHTML += `<div class="msg-ia">${data.reponse}</div>`;
  } catch {
    chatHistory.innerHTML += `<div class="msg-ia">Erreur de communication avec le coach IA.</div>`;
  }

  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// JOURNAL — ajout (invisible)
journalBtn.addEventListener("click", () => {
  if (!currentUser) {
    alert("Connecte-toi avant d’ajouter au journal.");
    return;
  }

  const txt = journalInput.value.trim();
  if (!txt) {
    alert("Écris ton ressenti.");
    return;
  }

  const dateStr = new Date().toLocaleString("fr-CA");

  const meteoTexte = meteoActuelle
    ? `Température: ${meteoActuelle.temp}°C, ${meteoActuelle.description}`
    : "Météo inconnue";

  const entry = {
    date: dateStr,
    ville: currentUser.city,
    meteo: meteoTexte,
    ressenti: txt,
    prenom: currentUser.name
  };

  // Ajouter au backup permanent
  if (!journalBackup[currentUser.email]) journalBackup[currentUser.email] = [];
  journalBackup[currentUser.email].push(entry);

  // Sauvegarder backup permanent
  localStorage.setItem(
    "journal_backup_" + currentUser.email,
    JSON.stringify(journalBackup[currentUser.email])
  );

  journalInput.value = "";
});

// LOGIN
document.getElementById("loginBtn").addEventListener("click", async () => {
  const name = loginName.value.trim();
  const email = loginEmail.value.trim();
  const city = loginCity.value.trim();

  if (!name || !email || !city) {
    alert("Veuillez remplir prénom, courriel et ville.");
    return;
  }

  currentUser = { name, email, city };

const runner = document.getElementById("runner");
if (runner) {
  runner.style.animation = "runCycle 0.8s steps(17) infinite, moveAcross 6s linear infinite";
}

  // Charger backup permanent de CET utilisateur
  const savedBackup = localStorage.getItem("journal_backup_" + email);
  journalBackup[email] = savedBackup ? JSON.parse(savedBackup) : [];

  // Effacer affichages
  chatHistory.innerHTML = "";

  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");

  chatHistory.innerHTML += `<div class="msg-ia">Bonjour ${name} 👋</div>`;

  const meteo = await chargerMeteo(city);
  genererConseils(meteo);
  if (meteo) applyDynamicTheme(meteo.description);

});


// Bouton “Changer de personne”
changeUserBtn.addEventListener("click", () => {
  currentUser = null;

  chatHistory.innerHTML = "";
  journalInput.value = "";

  loginName.value = "";
  loginEmail.value = "";
  loginCity.value = "";

  appScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
});

// Bouton Envoyer + Enter
chatSendBtn.addEventListener("click", () => {
  envoyerMessage(chatInput.value);
  chatInput.value = "";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    envoyerMessage(chatInput.value);
    chatInput.value = "";
  }
});

// Initialisation
(async () => {
  const ok = await backendPret();
  if (!ok) alert("Le backend refuse la connexion.");
})();





function applyTimeTheme() {
  const hour = new Date().getHours();
  const body = document.body;

  body.classList.remove("theme-morning", "theme-day", "theme-evening", "theme-night");

  if (hour >= 6 && hour < 10) {
    body.classList.add("theme-morning");
  } else if (hour >= 10 && hour < 17) {
    body.classList.add("theme-day");
  } else if (hour >= 17 && hour < 20) {
    body.classList.add("theme-evening");
  } else {
    body.classList.add("theme-night");
  }
}

// appliquer au chargement
applyTimeTheme();
if (meteoActuelle) applyDynamicTheme(meteoActuelle.description);

function applyDynamicTheme(weatherDescription) {
  const hour = new Date().getHours();
  const body = document.body;

  // Reset des classes
  body.classList.remove(
    "theme-morning", "theme-day", "theme-evening", "theme-night",
    "weather-sun", "weather-rain", "weather-snow", "weather-cloud", "weather-wind"
  );

  // Thème selon l'heure
  if (hour >= 6 && hour < 10) body.classList.add("theme-morning");
  else if (hour >= 10 && hour < 17) body.classList.add("theme-day");
  else if (hour >= 17 && hour < 20) body.classList.add("theme-evening");
  else body.classList.add("theme-night");

  // Thème météo
  const meteo = weatherDescription.toLowerCase();
  if (meteo.includes("sun") || meteo.includes("clear")) body.classList.add("weather-sun");
  else if (meteo.includes("rain")) body.classList.add("weather-rain");
  else if (meteo.includes("snow")) body.classList.add("weather-snow");
  else if (meteo.includes("cloud")) body.classList.add("weather-cloud");
  else if (meteo.includes("wind")) body.classList.add("weather-wind");
}










