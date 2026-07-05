---
name: game-logic
description: >
  Rules for game development tasks: formal game rules, state transitions,
  bounded strategic search, and final state verification. Use for
  implementing board games, card games, turn-based strategies,
  or any game with defined rules and state.
---

# Game Logic

## Key Rules

1. **Formal rules**: Encode game rules explicitly. Do not rely on implicit
   assumptions about valid moves or win conditions.
2. **State transitions**: Model game state as immutable data structures.
   Each move produces a new state; never mutate state in-place.
3. **Bounded search**: For AI opponents, use bounded search (e.g.,
   minimax with depth limit, Monte Carlo tree search with iteration cap).
4. **Final state verification**: Implement explicit win/draw/loss detection
   that is verified independently of the game loop.
5. **Input validation**: Validate all player moves against the current
   game state before applying them.

## Setup

```bash
# No special setup needed for game logic rules.
# Implementation language is task-dependent.
```

## Usage

See [state-transitions](references/state-transitions.md) for patterns
for modeling game state and transitions.

---

## Pseudocode

```
SKILL game-logic

INPUTS:
  gameType: string          // board, card, turn-based, realtime
  playerCount: number       // Number of players (1-N)
  ruleSource: string        // Formal rules location
  aiOpponent: boolean       // Whether AI opponent is needed

OUTPUTS:
  gameState: object         // Immutable game state representation
  validMoves: array         // List of legal moves from current state
  winDetection: function    // Function that checks win/draw/loss
  aiMove?: object           // AI-selected move (if applicable)

PRECONDITIONS:
  - Game rules explicitly encoded before state management
  - State transitions produce new state (no mutation)
  - All player moves validated before application

POSTCONDITIONS:
  - Game state is always valid after each move
  - Win/draw/loss detected correctly regardless of game phase
  - AI search is bounded by depth or iteration limit
  - Invalid moves are rejected with clear reason

ERROR_HANDLING:
  - If move is invalid -> reject with rule citation
  - If state becomes inconsistent -> reconstruct from move history
  - If AI search times out -> return best move found so far
```
