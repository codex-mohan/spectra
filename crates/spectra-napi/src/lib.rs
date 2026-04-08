use napi::{Env, JsObject, Result, Module};
use napi_derive::{module_exports, js_function};

#[module_exports]
fn init(mut module: Module) -> Result<()> {
    module.create_named_method("getVersion", get_version)?;
    Ok(())
}

#[js_function]
fn get_version(ctx: napi::CallContext) -> Result<String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}
