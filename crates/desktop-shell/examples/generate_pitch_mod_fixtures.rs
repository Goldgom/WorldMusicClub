//! Generate actual socket-free production handler results from public originals.
#[path = "../tests/support/pitch_mod_fixture.rs"]
mod fixture;
fn main() {
    let destination = std::env::args().nth(1).expect("output JSON path");
    std::fs::write(
        destination,
        serde_json::to_vec_pretty(&fixture::vectors()).unwrap(),
    )
    .unwrap();
}
