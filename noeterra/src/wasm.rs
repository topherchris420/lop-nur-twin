//! The WebAssembly boundary: three C-ABI exports and no imports. The host writes
//! a UTF-8 JSON request into memory it got from `noeterra_alloc`, calls
//! `noeterra_call`, reads the answer at the returned (pointer << 32 | length) and
//! hands it back with `noeterra_free`.

#[no_mangle]
pub extern "C" fn noeterra_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` and `len` must come from `noeterra_alloc` or `noeterra_call`.
#[no_mangle]
pub unsafe extern "C" fn noeterra_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// # Safety
/// `ptr` must point at `len` initialised bytes from `noeterra_alloc`.
#[no_mangle]
pub unsafe extern "C" fn noeterra_call(ptr: *const u8, len: usize) -> u64 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let answer = match std::str::from_utf8(bytes) {
        Ok(text) => crate::api::handle(text),
        Err(_) => r#"{"ok":false,"error":"request is not UTF-8"}"#.to_string(),
    };
    let mut out = answer.into_bytes();
    out.shrink_to_fit();
    let (p, l) = (out.as_mut_ptr(), out.len());
    std::mem::forget(out);
    ((p as u64) << 32) | l as u64
}
