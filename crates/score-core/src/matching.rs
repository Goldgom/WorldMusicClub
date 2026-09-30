//! Order-preserving, maximum-cardinality / minimum-absolute-error onset alignment.
//! Valid matching edges form an ordered bipartite graph. A Fenwick prefix optimum
//! gives sparse dynamic programming instead of a quadratic dense matrix.
use std::cmp::Ordering;
const NONE: u32 = u32::MAX;
#[derive(Clone, Copy, Debug)]
struct Best {
    error: f64,
    count: u32,
    node: u32,
}
impl Default for Best {
    fn default() -> Self {
        Self {
            error: 0.,
            count: 0,
            node: NONE,
        }
    }
}
fn better(a: Best, b: Best) -> Best {
    match a
        .count
        .cmp(&b.count)
        .then_with(|| b.error.total_cmp(&a.error))
        .then_with(|| b.node.cmp(&a.node))
    {
        Ordering::Greater => a,
        _ => b,
    }
}
#[derive(Clone, Copy)]
struct Link {
    previous: u32,
    target: u32,
    input: u32,
}
fn prefix(tree: &[Best], mut end: usize) -> Best {
    let mut best = Best::default();
    while end > 0 {
        best = better(best, tree[end]);
        end &= end - 1;
    }
    best
}
fn update(tree: &mut [Best], mut at: usize, value: Best) {
    while at < tree.len() {
        tree[at] = better(tree[at], value);
        at += at & at.wrapping_neg();
    }
}

/// Tuples are (original index, finite milliseconds), sorted by time then index.
/// The shared edge budget is an explicit ambiguity limit, never a greedy fallback.
pub(crate) fn align_pitch(
    targets: &[(usize, f64)],
    inputs: &[(usize, f64)],
    tolerance: f64,
    budget: &mut usize,
) -> Result<Vec<(usize, usize)>, String> {
    if targets.is_empty() || inputs.is_empty() {
        return Ok(vec![]);
    }
    if targets.len() == inputs.len()
        && targets
            .iter()
            .zip(inputs)
            .all(|(a, b)| (a.1 - b.1).abs() <= tolerance)
    {
        return Ok(targets
            .iter()
            .zip(inputs)
            .map(|(a, b)| (a.0, b.0))
            .collect());
    }
    // Coincident buckets are common in synthetic tests and ensemble scores.
    // Their cost does not depend on which equal-time endpoint is selected.
    if targets.iter().all(|x| x.1 == targets[0].1) {
        let mut candidates: Vec<_> = (0..inputs.len())
            .filter(|i| (inputs[*i].1 - targets[0].1).abs() <= tolerance)
            .collect();
        candidates.sort_by(|a, b| {
            (inputs[*a].1 - targets[0].1)
                .abs()
                .total_cmp(&(inputs[*b].1 - targets[0].1).abs())
                .then(a.cmp(b))
        });
        candidates.truncate(targets.len());
        candidates.sort_unstable();
        return Ok(candidates
            .iter()
            .enumerate()
            .map(|(i, j)| (targets[i].0, inputs[*j].0))
            .collect());
    }
    if inputs.iter().all(|x| x.1 == inputs[0].1) {
        let mut candidates: Vec<_> = (0..targets.len())
            .filter(|i| (targets[*i].1 - inputs[0].1).abs() <= tolerance)
            .collect();
        candidates.sort_by(|a, b| {
            (targets[*a].1 - inputs[0].1)
                .abs()
                .total_cmp(&(targets[*b].1 - inputs[0].1).abs())
                .then(a.cmp(b))
        });
        candidates.truncate(inputs.len());
        candidates.sort_unstable();
        return Ok(candidates
            .iter()
            .enumerate()
            .map(|(j, i)| (targets[*i].0, inputs[j].0))
            .collect());
    }
    let mut tree = vec![Best::default(); inputs.len() + 1];
    let mut links: Vec<Link> = vec![];
    for (target_index, time) in targets {
        let first = inputs.partition_point(|(_, at)| *at < time - tolerance);
        let end = inputs.partition_point(|(_, at)| *at <= time + tolerance);
        if end - first > *budget {
            return Err("Performance is too densely ambiguous for reliable onset alignment; shorten the range or select fewer simultaneous parts".into());
        }
        *budget -= end - first;
        let mut pending = Vec::with_capacity(end - first);
        for (j, (input_index, at)) in inputs.iter().enumerate().take(end).skip(first) {
            let previous = prefix(&tree, j); // strictly earlier input; current target updates are deferred
            let node = links.len() as u32;
            links.push(Link {
                previous: previous.node,
                target: *target_index as u32,
                input: *input_index as u32,
            });
            pending.push((
                j + 1,
                Best {
                    count: previous.count + 1,
                    error: previous.error + (time - at).abs(),
                    node,
                },
            ));
        }
        for (j, state) in pending {
            update(&mut tree, j, state);
        }
    }
    let mut result = vec![];
    let mut cursor = prefix(&tree, inputs.len()).node;
    while cursor != NONE {
        let link = links[cursor as usize];
        result.push((link.target as usize, link.input as usize));
        cursor = link.previous;
    }
    result.reverse();
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sequence(times: &[f64]) -> Vec<(usize, f64)> {
        times.iter().copied().enumerate().collect()
    }
    fn brute(t: &[f64], e: &[f64], tol: f64) -> (u32, f64) {
        let mut d = vec![Best::default(); (t.len() + 1) * (e.len() + 1)];
        for i in 1..=t.len() {
            for j in 1..=e.len() {
                let mut b = better(d[(i - 1) * (e.len() + 1) + j], d[i * (e.len() + 1) + j - 1]);
                if (t[i - 1] - e[j - 1]).abs() <= tol {
                    let prev = d[(i - 1) * (e.len() + 1) + j - 1];
                    b = better(
                        b,
                        Best {
                            count: prev.count + 1,
                            error: prev.error + (t[i - 1] - e[j - 1]).abs(),
                            node: 0,
                        },
                    );
                }
                d[i * (e.len() + 1) + j] = b;
            }
        }
        let b = d[t.len() * (e.len() + 1) + e.len()];
        (b.count, b.error)
    }
    #[test]
    fn consistently_late_repeated_notes_do_not_steal_future_targets() {
        let pairs = align_pitch(
            &sequence(&[0., 250.]),
            &sequence(&[140., 390.]),
            180.,
            &mut 100,
        )
        .unwrap();
        assert_eq!(pairs, vec![(0, 0), (1, 1)]);
    }
    #[test]
    fn maximum_cardinality_precedes_minimum_error() {
        let pairs = align_pitch(&sequence(&[0., 100.]), &sequence(&[90.]), 180., &mut 100).unwrap();
        assert_eq!(pairs, vec![(1, 0)]);
        let pairs = align_pitch(
            &sequence(&[0., 250.]),
            &sequence(&[140., 390., 900.]),
            180.,
            &mut 100,
        )
        .unwrap();
        assert_eq!(pairs, vec![(0, 0), (1, 1)]);
    }
    #[test]
    fn sparse_alignment_agrees_with_dense_reference() {
        let mut seed = 13_u32;
        for _ in 0..500 {
            let mut next = || {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                seed
            };
            let n = (next() % 7) as usize;
            let m = (next() % 7) as usize;
            let mut t = (0..n)
                .map(|_| f64::from(next() % 20) * 20.)
                .collect::<Vec<_>>();
            let mut e = (0..m)
                .map(|_| f64::from(next() % 25) * 20. - 50.)
                .collect::<Vec<_>>();
            t.sort_by(f64::total_cmp);
            e.sort_by(f64::total_cmp);
            let result = align_pitch(&sequence(&t), &sequence(&e), 100., &mut 1000).unwrap();
            let expected = brute(&t, &e, 100.);
            let cost = result
                .iter()
                .map(|(a, b)| (t[*a] - e[*b]).abs())
                .sum::<f64>();
            assert_eq!((result.len() as u32, cost), expected, "{t:?} {e:?}");
            assert!(result
                .windows(2)
                .all(|w| w[0].0 < w[1].0 && w[0].1 < w[1].1));
        }
    }
    #[test]
    fn coincident_dense_buckets_and_long_sparse_takes_are_bounded() {
        let t = (0..20_000).map(|i| (i, 0.)).collect::<Vec<_>>();
        let e = (0..20_001).map(|i| (i, 10.)).collect::<Vec<_>>();
        assert_eq!(align_pitch(&t, &e, 180., &mut 0).unwrap().len(), 20_000);
        let t = (0..20_000)
            .map(|i| (i, i as f64 * 250.))
            .collect::<Vec<_>>();
        let mut e = vec![(20_000, -1000.)];
        e.extend((0..20_000).map(|i| (i, i as f64 * 250. + 140.)));
        assert_eq!(
            align_pitch(&t, &e, 180., &mut 100_000).unwrap().len(),
            20_000
        );
    }
    #[test]
    fn ambiguous_edge_limit_is_reported_instead_of_silently_approximated() {
        let error = align_pitch(
            &sequence(&[0., 100.]),
            &sequence(&[20., 120., 130.]),
            180.,
            &mut 1,
        )
        .unwrap_err();
        assert!(error.contains("ambiguous"));
    }
}
