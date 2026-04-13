-- Table historique des prix produits
CREATE TABLE IF NOT EXISTS produits_prix_historique (
  id uuid default gen_random_uuid() primary key,
  produit_id uuid references produits(id),
  produit_nom text,
  ancien_prix integer,
  nouveau_prix integer,
  type_prix text, -- 'prix_achat' ou 'prix_vente'
  modifie_par text,
  modifie_le timestamp default now()
);

ALTER TABLE produits_prix_historique ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Acces public" ON produits_prix_historique FOR ALL USING (true) WITH CHECK (true);
