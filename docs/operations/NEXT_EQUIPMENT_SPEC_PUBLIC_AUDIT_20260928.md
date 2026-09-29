# Equipment specification: IOS2-073 and ODI-115, 2026-09-28

Read-only audit used only original `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`
members of the participant archive. Public manifest SHA-256:
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
For each source, ZIP member SHA, extracted PDF SHA, size, page count, and
Poppler-rendered page SHA were checked before visual review. No source was
marked CURRENT/APPROVED and no PD/RD pair was inferred.

| Code | Original source and inspected page | Finding from visual review | Verdict |
| --- | --- | --- | --- |
| `IOS2-073` | F0165, PD/VK, 24,884,908 bytes, 38 pages, PDF SHA `f4a34324aaf6779f05fc89379ddb2b15499a22dc0e9181389d87047ab1a39f64`, p.26 render SHA `6035873cbd7018085a50e8f575a872722b68ae16256e5e30860d54d89e76f4ed` | Pump unit specification includes model, Q, H, power and table rows, but describes a fire sprinkler system. This is not proof of a domestic drinking water pump station. | `ABSTAIN` |
| `ODI-115` | F0160, PD/EOM, 38,153,328 bytes, 126 pages, PDF SHA `72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd`, p.37 render SHA `eecde5e6d2859a77512fd3ada1333165ca98b7e95b0d30de8838f48fae946815` | Electrical one-line diagram labels `ЩЛ` as power board for a lift or accessible platform. It does not identify an installed platform, model, automation mode, or ODI drawing. | `ABSTAIN` |

Both codes retain `findingCount=null` and `parameterCoverage=null`.
The inspected words can be navigation leads only. An extractor must first
bind a model, system role, operating mode, and characteristics to one
verified equipment row and identifier. `IOS2-073` must distinguish domestic
drinking water from firefighting pumps. `ODI-115` must distinguish the
physical lift from its electrical supply board. Subject comparison also
requires approved source editions, matching object and phase, a verified
PD/RD pair, and equipment passports or test records where required.
