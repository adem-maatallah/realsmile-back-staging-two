const statusMap = {
  incomplete: "Soumission Incompléte",
  pending: "SmileSet En Cours",
  redesign_requested: "Expédié",
  complete: "Cas Terminé",
  in_construction: "En Fabrication",
  in_treatment: "En Traitement",
  needs_approval: "Approbation Requise",
  on_hold: "En Attente",
  rejected: "Rejeté",
};

const statusDbEnum = {
  incomplete: "incomplete",
  pending: "pending",
  redesign_requested: "redesign_requested",
  complete: "complete",
  in_construction: "in_construction",
  in_treatment: "in_treatment",
  needs_approval: "needs_approval",
  on_hold: "on_hold",
  rejected: "rejected",
};

const statusFrontendEnum = {
  "Soumission Incompléte": "incomplete",
  "SmileSet En Cours": "pending",
  Expédié: "redesign_requested",
  "Cas Terminé": "complete",
  "En Fabrication": "in_construction",
  "En Traitement": "in_treatment",
  "Approbation Requise": "needs_approval",
  "En Attente": "on_hold",
  Rejeté: "rejected",
};

const caseTypeDbEnum = {
  normal: "N",
  renumere: "R",
  command: "C",
};

const caseTypeMap = {
  N: "Normale",
  R: "Rénumérisé",
  C: "Commandé",
};

module.exports = {
  statusMap,
  statusDbEnum,
  caseTypeDbEnum,
  caseTypeMap,
  statusFrontendEnum,
};
