## Seal

The `sealed` event the [heartbeat](heartbeat.md) appends to the ledger when a [turn](turn.md) ends with every check passing.
It carries the diligence digest of the records since the previous seal.
A **turn** the **heartbeat** releases with a check still failing ends unsealed, and the ledger's unsealed tail records it.
