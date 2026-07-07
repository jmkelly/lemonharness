---
name: game-logic
description: >
  Game development rules: formal rule encoding, immutable state
  transitions, bounded AI search (minimax/MCTS), and independent
  win/draw/loss verification. Use for board games, card games,
  turn-based strategies, or any game with defined rules.
---

# Game Logic

**Leading word:** _bounds_ — every search, every state, every move has a hard bound. Enforce it.

## Rules

1. **Formal rules** — Encode game rules explicitly as data. No implicit assumptions about valid moves or win conditions.
2. **Immutable state** — Model game state as immutable data structures. Each move produces a new state; never mutate in-place.
3. **Bounded search** — AI opponents use bounded search: minimax with depth limit, MCTS with iteration cap. Never search unbounded.
4. **Independent win detection** — Implement win/draw/loss detection that is verified independently of the game loop, so the same check works from any phase.
5. **Input validation** — Validate every player move against the current state before applying it. Reject with the rule citation.

## Usage

See [`references/state-transitions.md`](references/state-transitions.md) for immutable state patterns.

---

## Pseudocode

```
SKILL game-logic

INPUTS:
  gameType: string          // board, card, turn-based, realtime
  playerCount: number       // 1-N
  ruleSource: string        // Formal rules location
  aiOpponent: boolean       // Whether AI opponent is needed

OUTPUTS:
  gameState: object         // Immutable game state
  validMoves: array         // Legal moves from current state
  winDetection: function    // Win/draw/loss check
  aiMove?: object           // AI-selected move (if applicable)

PRECONDITIONS:
  - Game rules encoded before state management
  - State transitions produce new state (no mutation)
  - All player moves validated before application

POSTCONDITIONS:
  - Game state always valid after each move
  - Win/draw/loss detected correctly regardless of phase
  - AI search bounded by depth or iteration limit
  - Invalid moves rejected with rule citation

ERROR_HANDLING:
  - Invalid move → reject with rule citation
  - Inconsistent state → reconstruct from move history
  - AI search timeout → return best move found so far
```
