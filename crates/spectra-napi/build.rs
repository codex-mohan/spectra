fn main() {
    napi_build::configure()
        .build()
        .expect("napi_build failed");
}
