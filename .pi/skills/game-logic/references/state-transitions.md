# State Transition Patterns

## Immutable Game State

```python
@dataclass(frozen=True)
class GameState:
    board: tuple  # Immutable board representation
    current_player: int
    move_history: tuple
    status: str  # "playing", "won", "draw"

    def apply_move(self, move) -> "GameState":
        """Return a new state with the move applied."""
        # Validate move
        new_board = self._apply_to_board(move)
        new_status = self._check_status(new_board)
        return GameState(
            board=new_board,
            current_player=1 - self.current_player,
            move_history=self.move_history + (move,),
            status=new_status,
        )
```

## Win Condition Detection

```python
def check_win(board, player) -> bool:
    """Check if player has won. Abstracted for any game."""
    raise NotImplementedError("Define per game")

def is_terminal(state: GameState) -> bool:
    return state.status != "playing"
```

## Bounded Search (Minimax Example)

```python
def minimax(state: GameState, depth: int, alpha: float, beta: float, maximizing: bool) -> float:
    if depth == 0 or is_terminal(state):
        return evaluate(state)
    if maximizing:
        value = -float("inf")
        for move in generate_moves(state):
            value = max(value, minimax(state.apply_move(move), depth - 1, alpha, beta, False))
            alpha = max(alpha, value)
            if beta <= alpha:
                break
        return value
    else:
        value = float("inf")
        for move in generate_moves(state):
            value = min(value, minimax(state.apply_move(move), depth - 1, alpha, beta, True))
            beta = min(beta, value)
            if beta <= alpha:
                break
        return value
```
