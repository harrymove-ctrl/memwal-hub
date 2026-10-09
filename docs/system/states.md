# States

Conversation row: idle, selected (`aria-current`), menu open, renaming. Archive removes the row from the list after the server accepts it. There is no undo.

Memory fact: suggested, saving, saved, failed, not confirmed. Saved is not selected again. Empty suggestions are not an error.

Connection pills: the label comes from the status request. Loading is not shown as disconnected when `memory.isLoading` is passed into `memoryBadge`.
