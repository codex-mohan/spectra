# <feature>

> One sentence: what this feature does and who invokes it.

## Source

- Entry: `packages/code/src/<path>` — <what lives here>
- Collaborators:
  - `packages/...` — <role>

## Registration / gating

- Registered by: <registry / tool index / startup path>
- Enabled by: <config key, default>
- Permission profile: <read / write / shell / network / none>

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `<field>` | `string` | yes | <meaning> |

## Outputs

- Tool result: <shape>
- Events: <AgentEvent / StreamEvent variants emitted>
- Files: <paths written, if any>

## Flow

1. <step with file:line if useful>
2. <step>

## State / persistence

- <where state lives, what survives restart>

## Security

- <path safety, SSRF, permission checks, secrets handling>

## Errors

| Condition | Result |
| --- | --- |
| <condition> | <message / error code> |

## Limitations

- <known tradeoff; do not encode it in the type/class name>

## Tests

- `packages/code/src/__tests__/<name>.test.ts` — <what it proves>

## Related

- <other feature pages, plans, settings keys>
