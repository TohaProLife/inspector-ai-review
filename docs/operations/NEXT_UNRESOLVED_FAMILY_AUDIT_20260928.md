# Next unresolved family audit: equipment specifications (2026-09-28)

## Scope and source integrity

This is a review-only sample of three unresolved codes sharing the proposed `EQUIPMENT_SPEC` extractor: `IOS4-077` (radiators), `IOS4-079` (general ventilation fans), and `PPM-112` (smoke or pressurization fans). The [family registry](../../services/worker/rules/parameter-family-registry-v1.json) leaves all three `UNRESOLVED` under `DESIGN_ONLY`; the [unresolved strategy](unresolved-parameter-strategy-v1.json) proposes the extractor family. No applicability, comparison, finding, or coverage is approved here.

Only original public PDFs marked `TRAIN_PUBLIC` / `INCLUDE` / `PUBLIC_TRAIN` in the [document manifest](../../datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl) were used. The manifest SHA-256 was `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`, matching the [v4 index audit](../../output/public-index-20260927/index-audit-v4-20260927.json) (`PASS`, 203 permitted sources, 10,142 PDF pages, zero audit errors). Exact ZIP members were extracted locally; each PDF SHA-256 matched the manifest before PDFium rendering and visual inspection.

| Source | Manifest role / pages | Original PDF SHA-256 | v4 page quality |
| --- | --- | --- | --- |
| F0171 | `PD/OV`, 177 | `a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc` | 177 `TEXT_LAYER_CANDIDATE`, 0 `OCR_REQUIRED` |
| F0202 | `RD_ID_MIXED/OV`, 36 | `632379a0e541f0c81e6b03e5528946730b4433939c796db4fdc1e5c3fc8b71ee` | 23 `TEXT_LAYER_CANDIDATE`, 13 `OCR_REQUIRED` |

The two inspected PDFs contain 213 pages, including 13 `OCR_REQUIRED`. The eight same-object `OV` PDFs listed in the permitted manifest contain 963 pages, including 106 `OCR_REQUIRED` (93 in F0201 and 13 in F0202). Their manifest roles are PD or `RD_ID_MIXED`; none is labeled a clean `RD/OV` source. These are index and manifest counts, not a statement that an RD page is absent. OCR-required pages remain unreviewed for this batch.

## Lexical leads versus page evidence

Direct v4 text-index searches within F0171 and F0202 returned `радиатор*` on 8 and 1 pages respectively, `вентилятор*` on 59 and 0, `дымоудален*` on 53 and 1, and `подпор*` on 15 and 0. Counts overlap and identify text to inspect; they do not measure rule applicability. The examples below were checked against original rendered pages. Page numbers are one-based PDF pages.

| Code | Original page and render SHA-256 | Visual disposition |
| --- | --- | --- |
| `IOS4-077` | F0171 p133, `bd5ac19db5f211af9fb5022518c898b94b0827b11f2698d2511a2b3a92ea3dce` | Actual PD radiator equipment schedule with `PRADO Classic` rows and heat-output notes. The inspected page does not establish a matched room, section count, or comparable current RD row. |
| `IOS4-077` | F0202 p6, `1b0690bc700ee009c41b27a95981bcf23a460701bf42dd607ef30712e253db28` | Change-register prose says a radiator in room 270 was replaced and moved. It is not an equipment-spec row and gives no verified model or heat output. `РД-ОВ2.1` appears in the page identifier, while the source remains manifest-classified `RD_ID_MIXED`; the effective revision has not been approved. |
| `IOS4-079` | F0171 p109, `f6d33d3cee7813c3d8935bbec37cdec6bddbf4d30082d3e41da3428a426bf164` | Actual PD fan schedule row: an axial exhaust fan with a model, flow, pressure, and power cells. This is a candidate row for review; the page alone does not establish required room air exchange, the same system in RD, or current revision. Other fan rows refer to a technical selection document rather than stating comparable performance. |
| `PPM-112` | F0171 p22, `6531b6bb0c56304f50ae826820555dfc27ea74e914788006fe43ad7f3a53de84` | Smoke-system calculation has labels for fan volume flow and normalized pressure with nearby numbers. It is a calculation, not a verified fan model or matched RD operating point. |
| `PPM-112` | F0171 p58, `00cabbc6fadc750a539d893477e5ee76e44c9b2942968d290b152f999fc50654` | Page crosses a system boundary: preceding calculation ends above a new `ПД20` pressurization heading. Adjacent values above the heading cannot be assigned to `ПД20`. |
| `PPM-112` | F0202 p11, `73f43895da9eed9dfc87aa53b19241b31f39a5d249e5b316791cf94a02d5d387` | The `дымоудаление` hit is in a project-document register naming a PD volume, not in a smoke fan specification. It is a topical false lead for this code. |

The v4 page artifacts for the inspected pages matched their indexed SHA-256 values, and the pages were rendered afresh from SHA-verified original PDFs. Generic table-row candidates on F0171 do not by themselves join model, quantity, flow, pressure, heat output, room, and system into an approved record.

## Verification needed before any rule execution

| Code | Required evidence still missing |
| --- | --- |
| `IOS4-077` | Approved PD and RD revisions; matching room and radiator identity; section count and heat output with units and design conditions; evidence that a change reduces the required capacity. |
| `IOS4-079` | Approved PD and RD revisions; same general-ventilation system and fan model/operating point; required air exchange and comparable RD flow/pressure with units. Smoke fans must be distinguished from general ventilation. The registry also records a public mapping conflict for this code. |
| `PPM-112` | Approved PD and RD revisions; same smoke-exhaust or pressurization system identifier; selected fan model and operating-point flow/pressure in both stages, with calculation values kept distinct from actual equipment rows. |

Review the `OCR_REQUIRED` pages with source-preserving OCR only if the selected scope needs them. A later reviewer must verify page segment, title block, revision, and PD/RD role from the document itself before accepting any comparison. No `TEST_HIDDEN` material or closed answers were used.
