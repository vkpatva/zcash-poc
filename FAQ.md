# Zcash-Style Shielded Pool — FAQ

Frequently asked questions about the shielded pool (notes, commitments, nullifiers) and the educational simulation in `simulation.js`. Concepts apply to Zcash-style designs; the code uses fake crypto for demo only.

---

## Contents

1. [Quick reference](#quick-reference)
2. [Concepts](#concepts)
3. [Privacy & tracking](#privacy--tracking)
4. [Receiving & spending](#receiving--spending)
5. [Wallets & UX](#wallets--ux)
6. [Code walkthrough](#code-walkthrough)
7. [Summary table](#summary-table)

---

## Quick reference

| Topic | Short answer |
|-------|--------------|
| **Commitment** | On-chain representation of “a note exists”; hides value and owner. |
| **Nullifier** | On-chain proof that “this note was spent”; prevents double-spend, unlinkable to commitment. |
| **Double-spend** | Same nullifier can’t be used twice; pool rejects duplicates. |
| **Spending more than you have** | Proof enforces input sum = output sum; you can’t create value. |
| **Multiple notes in one tx** | Allowed in real protocols; this simulation uses one note per z2z. |
| **Tracking note amount/owner from t→z** | No; only the commitment is visible, and it hides both. |
| **Storing notes** | Wallet app stores/derives note data; encrypted like rest of wallet; recovery via mnemonic + chain when supported. |

---

## Concepts

### What is the purpose of the nullifier and the commitment?

**Commitment**  
- **Purpose:** Represent that “a note exists” on the ledger **without** revealing its value or owner.  
- **How:** It’s a hash of (secretKey, value, randomness). Only someone who knows those can open it; to the network it’s just an opaque blob.  
- **When used:** When a note is **created** (e.g. in t2z or as an output of z2z), its commitment is added to the pool.  
- So: commitment = “there is a note; I’m not saying how much or who.”

**Nullifier**  
- **Purpose:** Mark that a **specific note has been spent**, so it can’t be spent again (double-spend prevention), and to do it in a way that doesn’t reveal **which** commitment was spent.  
- **How:** It’s a hash of (secretKey, randomness) — no value inside. Same note always gives the same nullifier; different notes (different randomness or owner) give different nullifiers.  
- **When used:** When the owner **spends** a note, they publish the nullifier. The protocol checks: “is this nullifier already in the set?” If yes → reject.  
- So: nullifier = “this note is now spent; you still don’t know which commitment it was.”

Together: **commitments** = what exists; **nullifiers** = what has been spent; both are unlinkable to actual amounts and owners.

---

### How are double-spending and “spending more than I have” prevented?

**Double-spending**  
- Each note can only be spent once because spending publishes a **nullifier** derived from that note.  
- The pool keeps a **set of nullifiers**. Before accepting a spend, it checks: “have we seen this nullifier before?” If **yes** → reject.  
- In the simulation: `pool.hasNullifier(nullifier)` and `pool.addNullifier(nullifier)` implement this.

**Spending more than you have**  
- The **proof** (in real Zcash, the zk-SNARK) must show that **sum of input note values = sum of output note values**. You can’t create value out of nothing.  
- In the simulation: `verifyProof(proof)` checks `inputSum === outputSum`.

So: **nullifiers** prevent the same note from being spent twice; **conservation proof** prevents inventing extra value.

---

### Can two (or more) notes be used in a single transaction?

- **In real Zcash (and similar systems):** Yes. A transaction can spend several notes as inputs and create several output notes (recipient + change). The proof still shows: sum of all input values = sum of all output values.  
- **In this simulation:** The code uses **one note per z2z** (see `findNoteForAmount`). So in the demo it’s a simplification; conceptually multiple notes per tx are allowed.

---

### Is the “key” in the note a public key or secret key?

- **For spending (nullifier):** The key that matters is the **secret key**. Nullifier = hash(**secretKey**, randomness). Only the owner has this; only they can spend.  
- **For receiving:** The sender uses the receiver’s **public** key (or payment address) to encrypt the memo and to bind the note to the receiver. The sender does **not** get the receiver’s secret key.  
- **In our simulation:** We used `ownerSecretKey` everywhere. In a real system, the sender uses the receiver’s **public** address to create the commitment; the nullifier still requires the receiver’s **secret** key.

---

## Privacy & tracking

### If I track a wallet on the transparent pool (e.g. its outputs), when they spend can I see which outputs were spent?

**Yes.** On the transparent side you have addresses and UTXOs. When they spend, the transaction **explicitly references** the UTXOs it spends as inputs. So you can see which of “their” outputs were spent — spending is visible and linkable.

---

### If I track commitments c1, c2, c3 on the shielded pool, when they spend can I tell which was spent?

**No.** When they spend, they publish a **nullifier**, not “I am spending c1.” The nullifier is derived from (secretKey, randomness) and is **not** tied to the commitment in a way that reveals which one. So you only see “a nullifier was added”; you cannot tell whether it was for c1, c2, or c3.

| Pool        | You track …              | When they spend, you see …             | Can you tell which “output” was spent? |
|------------|---------------------------|----------------------------------------|----------------------------------------|
| Transparent | Wallet’s UTXOs            | Tx inputs that reference those UTXOs   | **Yes** |
| Shielded   | Commitments c1, c2, c3    | New nullifier(s)                       | **No** |

---

### When a user publishes nullifiers n1, n2, n3, is any wallet tracked?

**No.** Nullifiers are unlinkable to identity. From the chain you only see that three nullifiers were added. You cannot tell which wallet spent them or which commitments were spent. The only way to link them to a user would be off-chain (e.g. network/IP, timing, or transparent parts of the same tx).

---

### If someone moves from transparent to shielded (t→z), can anyone track the note’s amount or owner?

**From the chain alone: no.** The chain only sees that a commitment was added (opaque hash) and possibly that some transparent amount left. The commitment hides value and owner.  
**Caveats:** If the same wallet is linked to an identity (e.g. transparent usage), that wallet is known to belong to that identity; timing and metadata can still be used for heuristics.

---

## Receiving & spending

### How does the receiver learn about the commitment when they receive?

- **That a commitment exists:** Everyone sees new commitments on-chain; the receiver doesn’t know which are theirs from the commitment alone.  
- **That a specific commitment is theirs, and the note data (value, randomness):** The sender **encrypts the note payload** (value, randomness, memo) to the **receiver’s address** and includes it in the transaction (e.g. memo field). The receiver scans the chain, **decrypts** each memo with their secret key; if decryption succeeds, they get (value, randomness), reconstruct the note, match it to a new commitment, and add it to their wallet.

So: the receiver sees the commitment on-chain; they learn “this commitment is mine” and the note data by **decrypting the encrypted memo** from the sender.

**In the simulation:** The code doesn’t model encryption; it just does `receiver.addNote(receiverNote)` as if the note is handed off in the same process.

---

### Can the sender compute the nullifier for the receiver’s note?

**No.** The nullifier is derived from **(owner’s secret key, randomness)**. The sender only has the receiver’s **public** key (or payment address), not their secret key. So only the **receiver** can compute the nullifier and spend the note.

---

### Does the user need to store notes? How are they stored securely?

- **Do they need to store notes?** Conceptually yes — the wallet must know (or derive) value and randomness (and has the secret key) to spend. The **wallet app** stores or derives note data; the user doesn’t manage notes by hand.  
- **How are they stored?** As part of the **encrypted wallet database** (on-device or in an encrypted backup). Same security model as the rest of the wallet.  
- **Recovery:** The **mnemonic** restores spending authority; if the wallet can **re-scan** the chain and re-derive notes from the seed, losing the local note cache is recoverable from mnemonic + chain.

---

## Wallets & UX

### Is multi-device sync possible in Zcash?

**Yes, with the same seed, but with caveats.**

- **Same seed on multiple devices:** You can restore a Zcash wallet on another device using the same BIP 39 mnemonic (or equivalent seed). Both devices then derive the same spending keys and can, in principle, see the same balance and spend the same notes after scanning the chain.  
- **How “sync” works:** Each device independently **scans the chain** (and decrypts memos for incoming payments). There is no central server that holds your notes; sync is “same seed → same keys → same view after scanning.” So multi-device “sync” is **recovery + full rescan** on each device, not live cloud sync of note data.  
- **Caveats:**  
  - If you spend from **one device**, the other device doesn’t know until it rescans (or re-imports) and sees the new nullifiers / updated chain. So you can have **double-spend risk** if two devices both try to spend the same note before either has rescanned. Wallets may guard against this with their own logic (e.g. after broadcasting a spend, mark the note spent locally and/or rescan).  
  - Transparent UTXO spends from one wallet may not be reflected on another when reusing the same seed, depending on wallet implementation (there are known sync edge cases in the ecosystem).  
  - **Best practice:** Treat one device as primary for spending, or ensure the wallet you use supports multi-device (e.g. Zashi’s DAG sync, or wallet-specific sync features) so that spending from one device is reflected correctly on others.

So: **multi-device is possible** by restoring the same seed on each device and letting each scan the chain; for a smooth experience you rely on wallet support and careful use to avoid double-spend and transparent-UTXO sync issues.

---

## Code walkthrough

What happens inside `simulation.js` (simplified, non-crypto model).

1. **Fake crypto:** `fakeHash`, `strToNum` — deterministic “hash” for demo; real Zcash uses Pedersen hashes, zk-SNARKs.  
2. **Note:** Private object with `ownerSecretKey`, `value`, `randomness`. `commitment()` = hash(secretKey, value, randomness) → stored on-chain when note is created. `nullifier()` = hash(secretKey, randomness) → stored on-chain when note is spent.  
3. **Wallet:** Secret key + local list of notes; balance = sum of note values; add/remove notes on receive/spend.  
4. **Shielded pool:** Stores `commitments[]` (unspent notes) and `nullifiers` (spent notes); does **not** store notes, values, or owners.  
5. **Proof:** `makeProof(inputSum, outputSum)`; `verifyProof()` checks inputSum === outputSum (conservation).  
6. **t2z:** Public amount → one new note for recipient → one new commitment on-chain; wallet adds note.  
7. **z2z:** Sender spends one note (nullifier checked, then added); receiver note + optional change note; new commitments added; proof verifies conservation.  
8. **Double-spend:** Same nullifier used again → rejected by pool.

So in short: **notes are private; only commitments (create) and nullifiers (spend) go on-chain; proof checks conservation; nullifiers block double-spend.**

---

## Summary table

| Topic | Short answer |
|-------|--------------|
| **Commitment** | On-chain representation of “a note exists”; hides value and owner. |
| **Nullifier** | On-chain proof that “this note was spent”; prevents double-spend, unlinkable to commitment. |
| **Double-spend** | Same nullifier can’t be used twice; pool rejects duplicates. |
| **Spending more than you have** | Proof enforces input sum = output sum; you can’t create value. |
| **Multiple notes in one tx** | Allowed in real protocols; this simulation uses one note per z2z. |
| **Tracking note amount/owner from t→z** | No; only the commitment is visible, and it hides both. |
| **Storing notes** | Wallet app stores/derives note data; encrypted like rest of wallet; recovery via mnemonic + chain when supported. |
| **Multi-device sync** | Possible with same seed; each device scans chain; caveats around double-spend and transparent-UTXO sync. |

---

*This FAQ is based on the educational simulation in `simulation.js` and general Zcash-style shielded pool design. Real systems use proper cryptography (zk-SNARKs, Pedersen hashes, etc.), not the fake hashes in this demo.*
