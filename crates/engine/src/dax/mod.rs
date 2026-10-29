//! Subconjunto de DAX: parser e compilação para expressões Polars.

pub mod compile;
pub mod parser;

pub use compile::{qual, Catalog, Compiler};
pub use parser::parse;
