fn main() {
    let mut b = cc::Build::new();
    b.include("vendor/xpress9/include").warnings(false).opt_level(2);
    for f in ["Xpress9DecHuffman.c", "Xpress9DecLz77.c", "Xpress9Misc.c", "freebi_x9.c"] {
        b.file(format!("vendor/xpress9/src/{f}"));
    }
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        b.define("BUILD_STATIC", None);
    }
    b.compile("freebi_xpress9");
    println!("cargo:rerun-if-changed=vendor/xpress9");
}
