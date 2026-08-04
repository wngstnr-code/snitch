-- Kunci primer evidence_items dijadikan majemuk (verification_id, id).
--
-- Id bukti deterministik dari isinya, jadi dua verifikasi atas petak yang sama
-- dengan batas bukti yang sama menghasilkan id identik. Dengan id sebagai PK
-- tunggal, penyimpanan verifikasi kedua ditolak senyap oleh onConflictDoNothing
-- dan bundle-nya tampil kehilangan sebagian besar buktinya.
ALTER TABLE "evidence_items" DROP CONSTRAINT "evidence_items_pkey";--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_verification_id_id_pk" PRIMARY KEY("verification_id","id");
