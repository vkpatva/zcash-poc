# Zcash-style shielded pool (educational simulation)

A minimal, **non-crypto-secure** JavaScript simulation that shows how a Zcash-style shielded pool works: notes, commitments, nullifiers, t→z / z→z transactions, and double-spend rejection.

## What this demonstrates

- **Note** (private): `ownerSecretKey`, `value`, `randomness` — never stored on-chain. Only the owner’s wallet holds this.
- **Commitment** (on-chain): `hash(secretKey, value, randomness)` — one per unspent note; hides value and owner.
- **Nullifier** (on-chain): `hash(secretKey, randomness)` — one per spent note; prevents double-spend; does not reveal which commitment was spent.
- **Wallet**: holds a secret key and tracks its own notes locally (balance = sum of note values).
- **Shielded pool**: stores commitments and nullifiers only; verifies conservation (input sum = output sum) and rejects reused nullifiers.

No real zk-SNARKs, elliptic curves, or crypto libraries — only integers and a fake hash. Correctness of relationships is the goal, not security.

For more Q&A (tracking, receiving, keys, multi-device sync, etc.), see **[FAQ.md](FAQ.md)**.

## What’s inside a note vs what’s on chain

| In the note (private, off-chain) | On the chain (public) |
|-----------------------------------|------------------------|
| `ownerSecretKey` — proves ownership | **Commitments** — one per unspent note |
| `value` — amount | **Nullifiers** — one per spent note |
| `randomness` — unique per note | Values, owners, and note contents are **not** stored |

The chain never sees notes, values, or owners; it only sees commitments and nullifiers.

## Run the demo

```bash
node simulation.js
```

The demo prints step-by-step logs so you can follow the flow.

### What you’ll see

1. **Reference** — Structure of a note (private fields + derived commitment/nullifier) and what the chain stores (commitments, nullifiers; notes/values/owners not stored).
2. **t2z** — Alice and Bob receive shielded notes (transparent → shielded); each step shows note creation, commitment, proof, and pool/wallet state.
3. **z2z** — Alice sends to Bob; logs show which note is spent, nullifier, new commitments (receiver + change), and conservation proof.
4. **Double-spend attempt** — Alice tries to spend the same note again; the network rejects the tx because the nullifier is already recorded.
5. **Further z2z** — Normal spend (e.g. Alice → Bob with change).
6. **Summary** — Final balances, commitments, and nullifiers.

After each operation you’ll see wallet state (balance + notes) and chain state (commitments, nullifiers).

### Sample output

Run `node simulation.js` and you should see output like the following (exact hashes may vary in a different runtime; structure is the same). Use it to verify the script behaves as expected.

```
=== Zcash-style shielded pool (educational) ===

Concepts: NOTE (private) → COMMITMENT (on-chain) | NULLIFIER (on spend, prevents double-spend)

-------- REFERENCE: What is a NOTE? What is ON CHAIN? --------
  --- Inside Example note (structure) (PRIVATE; never on-chain) ---
  {
    ownerSecretKey: 3738201996   // wallet secret; proves ownership
    value:          100   // amount this note represents
    randomness:     999   // unique per note; used in commitment & nullifier
  }
  Derived (computed when needed):
    commitment() => 1390a9d4  // hash(secretKey, value, randomness) → goes on-chain when note is created
    nullifier()  => 39f2e8e8  // hash(secretKey, randomness)       → goes on-chain when note is spent

  --- What is ON THE CHAIN (public ledger) ---
  STORED:
    commitments: [ (none) ]
      → One per unspent note; hides value and owner.
    nullifiers:  [ (none) ]
      → One per spent note; prevents double-spend; does not reveal which commitment was spent.
  NOT STORED (only in wallets / off-chain):
    notes, value, ownerSecretKey, randomness

-------- t2z: Alice receives 100 (transparent → shielded) --------
...
  [t2z] 1. Create PRIVATE note: value=100, randomness=1 (never sent on-chain)
  [t2z] 2. Commitment = hash(secretKey, value, randomness) => 1390a5ee (this goes on-chain)
  ...
Result: OK

-------- z2z: Alice sends 30 to Bob --------
  [z2z] 1. Sender selects one note: value=100, randomness=1 (private; chain never sees this)
  [z2z] 2. Nullifier = hash(secretKey, randomness) => 39f2e502 (unlinkable to commitment; proves spend once)
  ...
Result: OK

-------- DOUBLE-SPEND ATTEMPT: Alice tries to use the same note again --------
  [z2z] 1. Sender selects one note: value=100, randomness=1 (private; chain never sees this)
  [z2z] 2. Nullifier = hash(secretKey, randomness) => 39f2e502 (unlinkable to commitment; proves spend once)
Result: REJECTED: Double-spend: nullifier already used
  → Network rejects: nullifier already recorded; cannot spend the same note twice.

-------- z2z: Alice sends 20 to Bob (Alice gets change) --------
...
Result: OK

======== SUMMARY ========
Balances (from each wallet's private notes):
  Alice: 50
  Bob:   100
On-chain commitments (existing notes; values/owners hidden): 1390a5ee, 5fd9e9d, 5fd9c32, 1390a24f, 5fd9afe, 13909fe5
On-chain nullifiers (spent notes; which commitment was spent is hidden): 39f2e502, 39f2e505
```

## Structure

- **Crypto helpers**: `fakeHash()` — deterministic “hash” for commitments and nullifiers.
- **Note**: private fields; `commitment()` and `nullifier()` for pool/proof use.
- **Wallet**: secret key + local note list; `getBalance()`, `addNote()`, `removeNote()`, `findNoteForAmount()`.
- **ShieldedPool**: `commitments[]`, `nullifiers` Set, `verifyProof()`, rejects duplicate nullifiers.
- **t2z(pool, wallet, amount [, opts])**: public amount → one new note; one new commitment. `opts.log = true` for step-by-step logs.
- **z2z(pool, sender, receiver, amount [, opts])**: spend one note; create receiver note + optional change; add commitments and nullifier. Rejected if nullifier already in pool. `opts.log = true` for step-by-step logs.

## Use as a module

```js
const { Wallet, ShieldedPool, t2z, z2z } = require("./simulation.js");
const pool = new ShieldedPool();
const alice = new Wallet("Alice");
const bob = new Wallet("Bob");

t2z(pool, alice, 100);
z2z(pool, alice, bob, 30);
console.log(alice.getBalance()); // 70
console.log(bob.getBalance());   // 30
```
