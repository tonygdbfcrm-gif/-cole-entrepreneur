// Professeur IA — relie l'application à Google Gemini.
// La clé reste secrète : elle est lue dans les variables d'environnement Netlify.
const MODELE = process.env.GEMINI_MODEL || "gemini-flash-latest";

const REGLES = `Tu es le professeur de l'application « École des Entrepreneurs », un programme d'éducation financière et d'entrepreneuriat pour des collégiens de 11 à 15 ans.
Règles à respecter toujours :
- Parle en français simple, avec des phrases courtes, comme un bon professeur bienveillant. Tutoie l'élève.
- Réponses courtes : 6 phrases maximum. Une idée à la fois.
- Fais réfléchir l'élève : pose-lui une question, donne un indice plutôt que la réponse toute faite, puis vérifie qu'il a compris.
- Encourage les efforts, corrige les erreurs avec gentillesse et précision.
- Utilise des exemples concrets de la vie de l'élève (argent de poche, marché, petits achats).
- Ne demande jamais d'informations personnelles (nom complet, adresse, école, téléphone, photos). Si l'élève en donne, ne les répète pas.
- Aucune vraie transaction, aucun conseil d'investissement réel, pas de cryptomonnaies ni de paris d'argent.
- Si la conversation sort du sujet, ramène gentiment l'élève vers la leçon.
- Si l'élève dit qu'il est en danger, triste ou qu'on lui fait du mal, réponds avec douceur et encourage-le à en parler tout de suite à un adulte de confiance (parent, enseignant).
- Tu peux jouer un personnage (client, banquier, fournisseur) quand la mission le demande.
- Pas de tableaux ni de mise en forme compliquée : du texte simple avec des retours à la ligne.`;

const reponse = (code, corps) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corps),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reponse(405, { erreur: "Méthode non autorisée." });

  const cle = process.env.GEMINI_API_KEY;
  if (!cle) return reponse(500, { erreur: "La clé GEMINI_API_KEY n'est pas encore ajoutée dans Netlify (étape 6)." });

  if ((event.body || "").length > 30000) return reponse(413, { erreur: "Message trop long." });

  let donnees;
  try { donnees = JSON.parse(event.body || "{}"); }
  catch { return reponse(400, { erreur: "Requête invalide." }); }

  let messages = Array.isArray(donnees.messages) ? donnees.messages.slice(-14) : [];
  while (messages.length && messages[0].role !== "eleve") messages.shift();
  if (!messages.length) return reponse(400, { erreur: "Aucun message à envoyer." });

  const contents = messages.map((m) => ({
    role: m.role === "prof" ? "model" : "user",
    parts: [{ text: String(m.texte || "").slice(0, 1500) }],
  }));

  const consigne = REGLES + "\n\n" + String(donnees.contexte || "").slice(0, 5000);

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELE}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: consigne }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
      }
    );
    const sortie = await r.json();
    if (!r.ok) {
      const msg = sortie && sortie.error && sortie.error.message ? sortie.error.message : "erreur inconnue";
      const quota = r.status === 429;
      return reponse(r.status === 429 ? 429 : 502, {
        erreur: quota
          ? "Le prof a beaucoup travaillé aujourd'hui (limite gratuite atteinte). Réessaie un peu plus tard."
          : "Le prof IA ne répond pas : " + msg,
      });
    }
    const parts = (sortie.candidates && sortie.candidates[0] && sortie.candidates[0].content && sortie.candidates[0].content.parts) || [];
    const texte = parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
    if (!texte) return reponse(502, { erreur: "Le prof n'a pas trouvé ses mots. Reformule ta question et réessaie." });
    return reponse(200, { texte });
  } catch (e) {
    return reponse(502, { erreur: "Impossible de joindre le prof IA pour le moment." });
  }
};
