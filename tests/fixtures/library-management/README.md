# Original native query samples

`native-query-responses.json` was emitted by the Rust integration test
`query_contract_samples_preserve_native_identity_and_pack_issue_filter` with
`WMC_PACK_GROUP_CONTRACT_OUT` pointing at a test-owned output file. It contains
metadata for newly authored test songs and ZIPs in the test's temporary library.
It contains no user library content, credentials, private songs or copied music.

The sample includes all four nonempty query views, a shared immutable edition and
an import conflict that does not become a membership. JavaScript adapter and
actual app DOM tests consume the complete unchanged native responses. The
verification timestamp is fixture capture evidence, not a current user scan.
