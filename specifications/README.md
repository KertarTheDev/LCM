# Conversation Memory specifications

Status: normative for the current `kilocode-lcm-v7.4.21` implementation.

These documents define the publishable Conversation Memory behavior on Kilo Code `v7.4.21`
(`a5aaef74a81edaa9b5dac9b6b459d7700b973b62`). Upstream Kilo behavior remains authoritative wherever this set does not
state an LCM-specific augmentation.

Read in this order:

1. [Product contract](product-contract.md)
2. [Architecture and lifecycle](architecture-and-lifecycle.md)
3. [Storage and rebuild](storage-and-rebuild.md)
4. [Context tree](context-tree.md)
5. [Memory tools](memory-tools.md)
6. [API, UI, and export](api-ui-and-export.md)
7. [Verification and upstream compatibility](verification-and-upstream-compatibility.md)
8. [Release support](release-support.md)

The JSON files in [`fixtures/`](fixtures/) are deterministic acceptance inputs. Parent-workspace architecture plans
record why this design was selected, but this directory is the authority for implemented product behavior. Historical
specifications are non-normative.
