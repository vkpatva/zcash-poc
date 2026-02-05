/**
 * EDUCATIONAL ZCASH-STYLE SHIELDED POOL SIMULATION
 * ================================================
 * Non-crypto-secure. Demonstrates: notes, commitments, nullifiers,
 * t→z and z→z transactions. No real zk-SNARKs or elliptic curves.
 */

// ---------------------------------------------------------------------------
// 1. FAKE CRYPTO HELPERS
// ---------------------------------------------------------------------------
// Deterministic "hash" so the same inputs always give the same output.
// In real Zcash: Pedersen hash, etc. Here: simple integer mixing.

const PRIME = 0x7fffffff; // large prime for mixing

/**
 * Fake hash: deterministic "hash" of arbitrary arguments.
 * Used for commitments and nullifiers. NOT cryptographically secure.
 */
function fakeHash(...args) {
  let h = 0;
  for (const x of args) {
    const v = typeof x === "string" ? strToNum(x) : Number(x);
    h = ((h * 31) + (v >>> 0)) % PRIME;
  }
  return (h >>> 0).toString(16);
}

function strToNum(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n;
}

/** Unique randomness for new notes (counter for determinism in demo). */
let randomnessCounter = 0;
function nextRandomness() {
  return ++randomnessCounter;
}

// ---------------------------------------------------------------------------
// 2. NOTE (private; never stored on-chain)
// ---------------------------------------------------------------------------

class Note {
  /**
   * @param {number|string} ownerSecretKey - Wallet's secret key (ownership)
   * @param {number} value - Amount this note represents
   * @param {number} [randomness] - Optional; if omitted, generated
   */
  constructor(ownerSecretKey, value, randomness = nextRandomness()) {
    this.ownerSecretKey = ownerSecretKey;
    this.value = value;
    this.randomness = randomness;
  }

  /**
   * Commitment: public value stored in the shielded pool.
   * Hides owner and value; only verifiable by owner with secret key.
   */
  commitment() {
    return fakeHash("commit", this.ownerSecretKey, this.value, this.randomness);
  }

  /**
   * Nullifier: used once when spending this note.
   * Derived from (ownerSecretKey, randomness) so it doesn't reveal which
   * commitment was spent (unlinkability).
   */
  nullifier() {
    return fakeHash("nullify", this.ownerSecretKey, this.randomness);
  }
}

// ---------------------------------------------------------------------------
// 3. WALLET
// ---------------------------------------------------------------------------
// Owns a secret key; tracks only its own notes locally (no chain scanning).

class Wallet {
  /**
   * @param {string} name - Label for printing
   * @param {number|string} [secretKey] - If omitted, derived from name
   */
  constructor(name, secretKey = null) {
    this.name = name;
    this.secretKey = secretKey != null ? secretKey : strToNum("wallet-" + name);
    /** Notes this wallet owns (private; only we know these). */
    this.notes = [];
  }

  /** Balance = sum of all note values (only we can compute this). */
  getBalance() {
    return this.notes.reduce((sum, n) => sum + n.value, 0);
  }

  /** Add a note we received (t2z or z2z). */
  addNote(note) {
    this.notes.push(note);
  }

  /** Remove a note we spent (z2z). */
  removeNote(note) {
    const i = this.notes.indexOf(note);
    if (i !== -1) this.notes.splice(i, 1);
  }

  /** Find a single note with value >= amount (for simple z2z). */
  findNoteForAmount(amount) {
    return this.notes.find((n) => n.value >= amount) || null;
  }
}

// ---------------------------------------------------------------------------
// 4. SHIELDED POOL (ledger)
// ---------------------------------------------------------------------------
// Stores commitments (what exists) and nullifiers (what was spent).
// Does NOT store notes, values, or owners.

class ShieldedPool {
  constructor() {
    /** List of commitments (notes that exist in the pool). */
    this.commitments = [];
    /** Set of nullifiers (notes that have been spent). */
    this.nullifiers = new Set();
  }

  addCommitment(commitment) {
    this.commitments.push(commitment);
  }

  hasNullifier(nullifier) {
    return this.nullifiers.has(nullifier);
  }

  addNullifier(nullifier) {
    this.nullifiers.add(nullifier);
  }

  /**
   * Verify a "proof" for a transaction: input sum must equal output sum.
   * In real Zcash the zk-SNARK proves this; here we just check the equation.
   */
  verifyProof(proof) {
    return proof.inputSum === proof.outputSum;
  }
}

// ---------------------------------------------------------------------------
// 5. FAKE ZK PROOF
// ---------------------------------------------------------------------------
// In real Zcash: zk-SNARK proves (among other things) that
// sum(input note values) = sum(output note values) without revealing values.
// Here: plain object that carries inputSum and outputSum; verification is trivial.

function makeProof(inputSum, outputSum) {
  return { inputSum, outputSum };
}

// ---------------------------------------------------------------------------
// 6. TRANSACTION: t → z (transparent to shielded)
// ---------------------------------------------------------------------------
// Public amount moves into the pool; one new note is created for the wallet.

/**
 * @param {ShieldedPool} pool
 * @param {Wallet} wallet
 * @param {number} amount - Public amount (e.g. from "transparent" balance)
 * @param {{ log?: boolean }} [opts] - If opts.log, print step-by-step (for demo)
 * @returns {{ success: boolean, note?: Note, proof?: object, error?: string }}
 */
function t2z(pool, wallet, amount, opts = {}) {
  if (amount <= 0) return { success: false, error: "Amount must be positive" };
  const log = opts.log || false;

  if (log) console.log("  [t2z] 1. Create PRIVATE note: value=%d, randomness=%d (never sent on-chain)", amount, randomnessCounter + 1);
  const note = new Note(wallet.secretKey, amount);

  const commitment = note.commitment();
  if (log) console.log("  [t2z] 2. Commitment = hash(secretKey, value, randomness) => %s (this goes on-chain)", commitment);

  const proof = makeProof(amount, amount);
  if (log) console.log("  [t2z] 3. Proof: inputSum (transparent in) = %d, outputSum (new note) = %d => conservation ✓", proof.inputSum, proof.outputSum);
  if (!pool.verifyProof(proof)) {
    return { success: false, error: "Proof verification failed" };
  }

  pool.addCommitment(commitment);
  wallet.addNote(note);
  if (log) console.log("  [t2z] 4. Pool: add 1 commitment. Wallet \"%s\": add 1 note (balance now %d)", wallet.name, wallet.getBalance());

  return { success: true, note, proof };
}

// ---------------------------------------------------------------------------
// 7. TRANSACTION: z → z (shielded to shielded)
// ---------------------------------------------------------------------------
// Sender spends one note; receiver gets a note; sender gets change (if any).

/**
 * @param {ShieldedPool} pool
 * @param {Wallet} sender
 * @param {Wallet} receiver
 * @param {number} amount
 * @param {{ log?: boolean }} [opts] - If opts.log, print step-by-step (for demo)
 * @returns {{ success: boolean, error?: string }}
 */
function z2z(pool, sender, receiver, amount, opts = {}) {
  if (amount <= 0) return { success: false, error: "Amount must be positive" };
  const log = opts.log || false;

  const note = sender.findNoteForAmount(amount);
  if (!note) {
    return { success: false, error: "Insufficient balance (no single note >= amount)" };
  }
  if (log) console.log("  [z2z] 1. Sender selects one note: value=%d, randomness=%d (private; chain never sees this)", note.value, note.randomness);

  const nullifier = note.nullifier();
  if (log) console.log("  [z2z] 2. Nullifier = hash(secretKey, randomness) => %s (unlinkable to commitment; proves spend once)", nullifier);
  if (pool.hasNullifier(nullifier)) {
    return { success: false, error: "Double-spend: nullifier already used" };
  }
  if (log) console.log("  [z2z] 3. Check: nullifier not in pool ✓ (no double-spend)");

  const change = note.value - amount;
  const receiverNote = new Note(receiver.secretKey, amount);
  const changeNote = change > 0 ? new Note(sender.secretKey, change) : null;
  if (log) {
    console.log("  [z2z] 4. Create receiver note: value=%d => commitment %s", amount, receiverNote.commitment());
    if (changeNote) console.log("  [z2z] 5. Create change note: value=%d => commitment %s", changeNote.value, changeNote.commitment());
    else console.log("  [z2z] 5. No change (exact spend).");
  }

  const inputSum = note.value;
  const outputSum = amount + (changeNote ? changeNote.value : 0);
  const proof = makeProof(inputSum, outputSum);
  if (log) console.log("  [z2z] 6. Proof: inputSum=%d, outputSum=%d => conservation ✓", proof.inputSum, proof.outputSum);

  if (!pool.verifyProof(proof)) {
    return { success: false, error: "Proof verification failed (inputSum !== outputSum)" };
  }

  pool.addCommitment(receiverNote.commitment());
  if (changeNote) pool.addCommitment(changeNote.commitment());
  pool.addNullifier(nullifier);
  if (log) console.log("  [z2z] 7. Pool: add %d commitment(s), record 1 nullifier. Wallets: sender removes spent note, adds change; receiver adds note.", changeNote ? 2 : 1);

  sender.removeNote(note);
  receiver.addNote(receiverNote);
  if (changeNote) sender.addNote(changeNote);

  return { success: true };
}

// ---------------------------------------------------------------------------
// 8. DEMO HELPERS (for clearer logs)
// ---------------------------------------------------------------------------

/**
 * Show what's INSIDE a note (private; only the owner has this).
 * The chain never stores this object.
 */
function describeNote(note, label = "Note") {
  console.log("  --- Inside %s (PRIVATE; never on-chain) ---", label);
  console.log("  {");
  console.log("    ownerSecretKey: %s   // wallet secret; proves ownership", String(note.ownerSecretKey));
  console.log("    value:          %d   // amount this note represents", note.value);
  console.log("    randomness:     %d   // unique per note; used in commitment & nullifier", note.randomness);
  console.log("  }");
  console.log("  Derived (computed when needed):");
  console.log("    commitment() => %s  // hash(secretKey, value, randomness) → goes on-chain when note is created", note.commitment());
  console.log("    nullifier()  => %s  // hash(secretKey, randomness)       → goes on-chain when note is spent", note.nullifier());
}

/**
 * Show exactly what the CHAIN stores. Notes, values, owners are NOT on-chain.
 */
function logWhatIsOnChain(pool) {
  console.log("  --- What is ON THE CHAIN (public ledger) ---");
  console.log("  STORED:");
  console.log("    commitments: [ %s ]", pool.commitments.length ? pool.commitments.join(", ") : "(none)");
  console.log("      → One per unspent note; hides value and owner.");
  console.log("    nullifiers:  [ %s ]", pool.nullifiers.size ? Array.from(pool.nullifiers).join(", ") : "(none)");
  console.log("      → One per spent note; prevents double-spend; does not reveal which commitment was spent.");
  console.log("  NOT STORED (only in wallets / off-chain):");
  console.log("    notes, value, ownerSecretKey, randomness");
}

/** Log what a wallet "sees" (notes: value + randomness only; no secretKey). */
function logWalletState(wallet) {
  const parts = wallet.notes.map((n, i) => `note${i + 1}(value=${n.value}, r=${n.randomness})`);
  console.log("  %s: balance=%d, notes [%s]", wallet.name, wallet.getBalance(), parts.join(", ") || "none");
}

/** Log what the chain sees: commitments count, list, nullifiers count, list. */
function logPoolState(pool, label = "Pool") {
  console.log("  %s: %d commitment(s) %s", label, pool.commitments.length, JSON.stringify(pool.commitments));
  console.log("  %s: %d nullifier(s) (spent) %s", label, pool.nullifiers.size, JSON.stringify(Array.from(pool.nullifiers)));
}

// ---------------------------------------------------------------------------
// 9. DEMO
// ---------------------------------------------------------------------------

function runDemo() {
  const pool = new ShieldedPool();
  const alice = new Wallet("Alice");
  const bob = new Wallet("Bob");

  console.log("=== Zcash-style shielded pool (educational) ===\n");
  console.log("Concepts: NOTE (private) → COMMITMENT (on-chain) | NULLIFIER (on spend, prevents double-spend)\n");

  // --- Reference: what a note looks like vs what's on chain ---
  console.log("-------- REFERENCE: What is a NOTE? What is ON CHAIN? --------");
  const exampleNote = new Note(strToNum("wallet-Alice"), 100, 999); // 999 = example only
  describeNote(exampleNote, "Example note (structure)");
  console.log("");
  logWhatIsOnChain(pool);
  console.log("");

  // --- t2z: Alice ---
  console.log("-------- t2z: Alice receives 100 (transparent → shielded) --------");
  console.log("Meaning: public amount 100 enters the pool; Alice gets one private note.\n");
  const r1 = t2z(pool, alice, 100, { log: true });
  console.log("Result:", r1.success ? "OK" : r1.error);
  console.log("");
  console.log("What Alice's note looks like (private; only she has this):");
  describeNote(r1.note, "Alice's note");
  console.log("");
  console.log("What the chain stores after this t2z:");
  logWhatIsOnChain(pool);
  console.log("");
  console.log("After t2z(Alice, 100):");
  logWalletState(alice);
  logPoolState(pool, "Chain");
  console.log("");

  // --- t2z: Bob ---
  console.log("-------- t2z: Bob receives 50 --------\n");
  t2z(pool, bob, 50, { log: true });
  console.log("After t2z(Bob, 50):");
  logWalletState(alice);
  logWalletState(bob);
  logPoolState(pool, "Chain");
  console.log("");

  // --- z2z: Alice → Bob 30 ---
  console.log("-------- z2z: Alice sends 30 to Bob --------");
  console.log("Meaning: Alice spends one note; Bob gets a note (30); Alice gets change (70).\n");
  const noteAliceWillSpend = alice.findNoteForAmount(30);
  const r2 = z2z(pool, alice, bob, 30, { log: true });
  console.log("Result:", r2.success ? "OK" : r2.error);
  console.log("");
  console.log("After z2z(30):");
  logWalletState(alice);
  logWalletState(bob);
  logPoolState(pool, "Chain");
  console.log("");

  // --- Double-spend attempt: Alice tries to reuse the note she just spent ---
  console.log("-------- DOUBLE-SPEND ATTEMPT: Alice tries to use the same note again --------");
  console.log("Alice still has the note data (value=%d, r=%d) in memory and tries to spend it again.", noteAliceWillSpend.value, noteAliceWillSpend.randomness);
  console.log("The network only sees the nullifier. Same note => same nullifier => already in pool.\n");
  const aliceNotesBeforeDoubleSpend = [...alice.notes];
  alice.notes = [noteAliceWillSpend];
  console.log("  (Simulation: we re-add the already-spent note to Alice's wallet and she tries to send 30 to Bob again.)\n");
  const rDoubleSpend = z2z(pool, alice, bob, 30, { log: true });
  console.log("Result:", rDoubleSpend.success ? "OK" : "REJECTED:", rDoubleSpend.error || "");
  if (!rDoubleSpend.success) {
    console.log("  → Network rejects: nullifier already recorded; cannot spend the same note twice.\n");
  }
  alice.notes = aliceNotesBeforeDoubleSpend;
  console.log("(Alice's wallet restored to correct state after rejected tx.)\n");

  // --- z2z: Alice → Bob 20 (change) ---
  console.log("-------- z2z: Alice sends 20 to Bob (Alice gets change) --------\n");
  z2z(pool, alice, bob, 20, { log: true });
  console.log("After z2z(20):");
  logWalletState(alice);
  logWalletState(bob);
  logPoolState(pool, "Chain");
  console.log("");

  // --- Final summary ---
  console.log("======== SUMMARY ========");
  console.log("Balances (from each wallet's private notes):");
  console.log("  Alice: %d", alice.getBalance());
  console.log("  Bob:   %d", bob.getBalance());
  console.log("On-chain commitments (existing notes; values/owners hidden): %s", pool.commitments.join(", "));
  console.log("On-chain nullifiers (spent notes; which commitment was spent is hidden): %s", Array.from(pool.nullifiers).join(", "));
}

// Run if executed directly
if (typeof require !== "undefined" && require.main === module) {
  runDemo();
}

// Export for use as module
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fakeHash,
    Note,
    Wallet,
    ShieldedPool,
    makeProof,
    t2z,
    z2z,
    runDemo,
  };
}
