pub fn add(a: i32, b: i32) -> i32 { a - b } // BUG
pub fn first(v: &[i32]) -> i32 { v[0] }     // BUG: panics on empty
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn adds() { assert_eq!(add(2, 3), 5); }
    #[test] fn first_of_empty() { assert_eq!(first(&[]), 0); }
    #[test] fn ok_test() { assert_eq!(1, 1); }
}
