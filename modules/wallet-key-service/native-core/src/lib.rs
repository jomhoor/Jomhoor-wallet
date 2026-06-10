use num_bigint::{BigInt, BigUint, Sign};
use num_traits::{One, Zero};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::slice;
use zeroize::Zeroizing;

const FIELD_MODULUS_DEC: &str =
    "21888242871839275222246405745257275088548364400416034343698204186575808495617";
const CURVE_ORDER_DEC: &str =
    "21888242871839275222246405745257275088614511777268538073601725287587578984328";
const BASE8_X_DEC: &str =
    "5299619240641551281634865583518297030282874472190772894086521144482721001553";
const BASE8_Y_DEC: &str =
    "16950150798460657717958625567821834550301663161624707787222815936182638968203";
const CURVE_A_DEC: &str = "168700";
const CURVE_D_DEC: &str = "168696";

const TEST_SECRET_HEX: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const TEST_EVENT_ID: &str = "123456789";
const TEST_CHALLENGE_HEX: &str =
    "0x7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f";
const TEST_WALLET_ADDRESS: &str =
    "0x13fba4da9e8a07539b00d6012e148288f7a9ff8ba016de9952f3c98d8acf1499";
const TEST_NULLIFIER: &str =
    "2343193253080191263137285062931063059752921021159891874564361510016549154941";
const TEST_SIGNATURE: &str =
    "0x6900be8e540d6b22db35f53230c1103d74809c29c82e10a26c71774cd98f2328313705ec55ed18a057a495f52a1711ea1ac80e94eb0bc9fbff2d707987718103";

static FIELD_MODULUS: Lazy<BigUint> = Lazy::new(|| dec(FIELD_MODULUS_DEC));
static SUB_ORDER: Lazy<BigUint> = Lazy::new(|| dec(CURVE_ORDER_DEC) >> 3usize);
static BASE8: Lazy<Point> = Lazy::new(|| Point {
    x: dec(BASE8_X_DEC),
    y: dec(BASE8_Y_DEC),
});
static CURVE_A: Lazy<BigUint> = Lazy::new(|| dec(CURVE_A_DEC));
static CURVE_D: Lazy<BigUint> = Lazy::new(|| dec(CURVE_D_DEC));
static POSEIDON_PARAMS: Lazy<HashMap<String, PoseidonParams>> = Lazy::new(|| {
    serde_json::from_str(include_str!("poseidon-constants.json"))
        .expect("generated Poseidon constants must be valid")
});

#[derive(Clone)]
struct Point {
    x: BigUint,
    y: BigUint,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct PoseidonParams {
    C: Vec<String>,
    S: Vec<String>,
    M: Vec<Vec<String>>,
    P: Vec<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicMaterial {
    public_key_x: String,
    public_key_y: String,
    public_key_hash: String,
    wallet_address: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompatibilityResult {
    passed: bool,
    public_material_matches: bool,
    nullifier_matches: bool,
    signature_matches: bool,
}

#[derive(Serialize)]
#[serde(untagged)]
enum FfiResponse<T: Serialize> {
    Ok { ok: T },
    Error { error: String },
}

fn dec(value: &str) -> BigUint {
    BigUint::parse_bytes(value.as_bytes(), 10).expect("valid decimal constant")
}

fn field(value: BigUint) -> BigUint {
    value % &*FIELD_MODULUS
}

fn f_add(a: &BigUint, b: &BigUint) -> BigUint {
    field(a + b)
}

fn f_sub(a: &BigUint, b: &BigUint) -> BigUint {
    if a >= b {
        a - b
    } else {
        &*FIELD_MODULUS - (b - a)
    }
}

fn f_mul(a: &BigUint, b: &BigUint) -> BigUint {
    field(a * b)
}

fn f_inv(value: &BigUint) -> Result<BigUint, String> {
    if value.is_zero() {
        return Err("division by zero".into());
    }

    let modulus = BigInt::from_biguint(Sign::Plus, FIELD_MODULUS.clone());
    let mut t = BigInt::zero();
    let mut new_t = BigInt::one();
    let mut r = modulus.clone();
    let mut new_r = BigInt::from_biguint(Sign::Plus, value.clone());

    while !new_r.is_zero() {
        let quotient = &r / &new_r;
        (t, new_t) = (new_t.clone(), t - &quotient * &new_t);
        (r, new_r) = (new_r.clone(), r - quotient * &new_r);
    }

    if r != BigInt::one() {
        return Err("field element is not invertible".into());
    }
    if t.sign() == Sign::Minus {
        t += modulus;
    }
    t.to_biguint()
        .ok_or_else(|| "failed to normalize inverse".into())
}

fn f_div(a: &BigUint, b: &BigUint) -> Result<BigUint, String> {
    Ok(f_mul(a, &f_inv(b)?))
}

fn add_point(a: &Point, b: &Point) -> Result<Point, String> {
    let beta = f_mul(&a.x, &b.y);
    let gamma = f_mul(&a.y, &b.x);
    let delta = f_mul(&f_sub(&a.y, &f_mul(&CURVE_A, &a.x)), &f_add(&b.x, &b.y));
    let tau = f_mul(&beta, &gamma);
    let d_tau = f_mul(&CURVE_D, &tau);

    Ok(Point {
        x: f_div(&f_add(&beta, &gamma), &f_add(&BigUint::one(), &d_tau))?,
        y: f_div(
            &f_add(&delta, &f_sub(&f_mul(&CURVE_A, &beta), &gamma)),
            &f_sub(&BigUint::one(), &d_tau),
        )?,
    })
}

fn mul_point(base: &Point, scalar: &BigUint) -> Result<Point, String> {
    let mut result = Point {
        x: BigUint::zero(),
        y: BigUint::one(),
    };
    let mut exponent = scalar.clone();
    let mut point = base.clone();

    while !exponent.is_zero() {
        if (&exponent & BigUint::one()) == BigUint::one() {
            result = add_point(&result, &point)?;
        }
        point = add_point(&point, &point)?;
        exponent >>= 1usize;
    }

    Ok(result)
}

fn pow5(value: &BigUint) -> BigUint {
    let square = f_mul(value, value);
    f_mul(value, &f_mul(&square, &square))
}

fn parse_vector(values: &[String]) -> Vec<BigUint> {
    values.iter().map(|value| dec(value)).collect()
}

fn parse_matrix(values: &[Vec<String>]) -> Vec<Vec<BigUint>> {
    values.iter().map(|row| parse_vector(row)).collect()
}

fn mix(state: &[BigUint], matrix: &[Vec<BigUint>]) -> Vec<BigUint> {
    (0..state.len())
        .map(|column| {
            state
                .iter()
                .enumerate()
                .fold(BigUint::zero(), |acc, (row, value)| {
                    f_add(&acc, &f_mul(&matrix[row][column], value))
                })
        })
        .collect()
}

fn poseidon(inputs: &[BigUint]) -> Result<BigUint, String> {
    const PARTIAL_ROUNDS: [usize; 16] = [
        56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68,
    ];

    if inputs.is_empty() || inputs.len() > PARTIAL_ROUNDS.len() {
        return Err("invalid Poseidon input count".into());
    }
    if inputs.iter().any(|value| value >= &*FIELD_MODULUS) {
        return Err("Poseidon input is outside the BN254 field".into());
    }

    let width = inputs.len() + 1;
    let params = POSEIDON_PARAMS
        .get(&width.to_string())
        .ok_or_else(|| format!("Poseidon width {width} is not bundled"))?;
    let constants = parse_vector(&params.C);
    let sparse = parse_vector(&params.S);
    let matrix = parse_matrix(&params.M);
    let pre_sparse = parse_matrix(&params.P);
    let partial_rounds = PARTIAL_ROUNDS[width - 2];
    let mut state = vec![BigUint::zero()];
    state.extend(inputs.iter().cloned());

    for (index, value) in state.iter_mut().enumerate() {
        *value = f_add(value, &constants[index]);
    }

    for round in 0..3 {
        state.iter_mut().for_each(|value| *value = pow5(value));
        for index in 0..width {
            state[index] = f_add(&state[index], &constants[(round + 1) * width + index]);
        }
        state = mix(&state, &matrix);
    }

    state.iter_mut().for_each(|value| *value = pow5(value));
    for index in 0..width {
        state[index] = f_add(&state[index], &constants[4 * width + index]);
    }
    state = mix(&state, &pre_sparse);

    for round in 0..partial_rounds {
        state[0] = pow5(&state[0]);
        state[0] = f_add(&state[0], &constants[5 * width + round]);

        let offset = (width * 2 - 1) * round;
        let new_first = state
            .iter()
            .enumerate()
            .fold(BigUint::zero(), |acc, (index, value)| {
                f_add(&acc, &f_mul(&sparse[offset + index], value))
            });
        for index in 1..width {
            state[index] = f_add(
                &state[index],
                &f_mul(&state[0], &sparse[offset + width + index - 1]),
            );
        }
        state[0] = new_first;
    }

    for round in 0..3 {
        state.iter_mut().for_each(|value| *value = pow5(value));
        let constant_offset = 5 * width + partial_rounds + round * width;
        for index in 0..width {
            state[index] = f_add(&state[index], &constants[constant_offset + index]);
        }
        state = mix(&state, &matrix);
    }

    state.iter_mut().for_each(|value| *value = pow5(value));
    Ok(mix(&state, &matrix)[0].clone())
}

fn secret_scalar(secret: &[u8]) -> Result<BigUint, String> {
    if secret.len() != 32 {
        return Err("wallet key must be exactly 32 bytes".into());
    }
    let scalar = BigUint::from_bytes_be(secret);
    if scalar.is_zero() || scalar >= *FIELD_MODULUS {
        return Err("wallet key is outside the supported scalar range".into());
    }
    Ok(scalar)
}

fn derive_public_material(secret: &[u8]) -> Result<PublicMaterial, String> {
    let scalar = secret_scalar(secret)?;
    let public_key = mul_point(&BASE8, &scalar)?;
    let public_key_hash = poseidon(&[public_key.x.clone(), public_key.y.clone()])?;
    let wallet_address = format!("0x{}", to_fixed_hex(&public_key_hash, 32));

    Ok(PublicMaterial {
        public_key_x: public_key.x.to_str_radix(10),
        public_key_y: public_key.y.to_str_radix(10),
        public_key_hash: public_key_hash.to_str_radix(10),
        wallet_address,
    })
}

fn normalize_hex(value: &str) -> &str {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value)
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    let normalized = normalize_hex(value);
    if !normalized.len().is_multiple_of(2)
        || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("invalid hex value".into());
    }
    (0..normalized.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&normalized[index..index + 2], 16)
                .map_err(|_| "invalid hex value".into())
        })
        .collect()
}

fn to_fixed_hex(value: &BigUint, byte_length: usize) -> String {
    format!("{:0width$x}", value, width = byte_length * 2)
}

fn to_fixed_le(value: &BigUint, byte_length: usize) -> Result<Vec<u8>, String> {
    let mut bytes = value.to_bytes_le();
    if bytes.len() > byte_length {
        return Err("integer does not fit requested byte length".into());
    }
    bytes.resize(byte_length, 0);
    Ok(bytes)
}

fn sign_challenge(secret: &[u8], challenge_hex: &str) -> Result<String, String> {
    let challenge = decode_hex(challenge_hex)?;
    if challenge.len() != 32 {
        return Err("challenge must be exactly 32 bytes".into());
    }

    let scalar = secret_scalar(secret)?;
    let public_key = mul_point(&BASE8, &scalar)?;
    let message = BigUint::from_bytes_be(&challenge) % &*FIELD_MODULUS;
    let nonce = poseidon(&[scalar.clone(), message.clone()])? % &*SUB_ORDER;
    let r8 = mul_point(&BASE8, &nonce)?;
    let hash = poseidon(&[
        r8.x.clone(),
        r8.y.clone(),
        public_key.x.clone(),
        public_key.y.clone(),
        message,
    ])?;
    let signature_scalar =
        (nonce + ((BigUint::from(8u8) * hash * scalar) % &*SUB_ORDER)) % &*SUB_ORDER;

    let mut packed_point = to_fixed_le(&r8.y, 32)?;
    if r8.x > ((&*FIELD_MODULUS - BigUint::one()) >> 1usize) {
        packed_point[31] |= 0x80;
    }
    packed_point.extend(to_fixed_le(&signature_scalar, 32)?);

    Ok(format!("0x{}", bytes_to_hex(&packed_point)))
}

fn derive_nullifier(secret: &[u8], event_id: &str) -> Result<String, String> {
    let scalar = secret_scalar(secret)? % &*FIELD_MODULUS;
    let event = dec(event_id);
    if event >= *FIELD_MODULUS {
        return Err("event id is outside the BN254 field".into());
    }
    let secret_hash = poseidon(std::slice::from_ref(&scalar))?;
    Ok(poseidon(&[scalar, secret_hash, event])?.to_str_radix(10))
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn response<T: Serialize>(result: Result<T, String>) -> *mut c_char {
    let value = match result {
        Ok(ok) => serde_json::to_string(&FfiResponse::Ok { ok }),
        Err(error) => serde_json::to_string(&FfiResponse::<()>::Error { error }),
    }
    .unwrap_or_else(|_| "{\"error\":\"serialization failed\"}".into());

    CString::new(value)
        .expect("JSON response cannot contain NUL")
        .into_raw()
}

unsafe fn secret_from_raw<'a>(secret: *const u8, secret_len: usize) -> Result<&'a [u8], String> {
    if secret.is_null() {
        return Err("wallet key pointer is null".into());
    }
    Ok(slice::from_raw_parts(secret, secret_len))
}

unsafe fn string_from_raw<'a>(value: *const c_char) -> Result<&'a str, String> {
    if value.is_null() {
        return Err("string argument is null".into());
    }
    CStr::from_ptr(value)
        .to_str()
        .map_err(|_| "string argument is not valid UTF-8".into())
}

#[no_mangle]
/// # Safety
///
/// `secret` must point to a readable buffer of `secret_len` bytes for the
/// duration of this call.
pub unsafe extern "C" fn wallet_key_public_material(
    secret: *const u8,
    secret_len: usize,
) -> *mut c_char {
    response(secret_from_raw(secret, secret_len).and_then(derive_public_material))
}

#[no_mangle]
/// # Safety
///
/// `secret` must point to a readable buffer of `secret_len` bytes and
/// `challenge_hex` must point to a valid NUL-terminated UTF-8 string.
pub unsafe extern "C" fn wallet_key_sign_challenge(
    secret: *const u8,
    secret_len: usize,
    challenge_hex: *const c_char,
) -> *mut c_char {
    response(secret_from_raw(secret, secret_len).and_then(|key| {
        string_from_raw(challenge_hex).and_then(|value| sign_challenge(key, value))
    }))
}

#[no_mangle]
/// # Safety
///
/// `secret` must point to a readable buffer of `secret_len` bytes and
/// `event_id` must point to a valid NUL-terminated UTF-8 string.
pub unsafe extern "C" fn wallet_key_derive_nullifier(
    secret: *const u8,
    secret_len: usize,
    event_id: *const c_char,
) -> *mut c_char {
    response(
        secret_from_raw(secret, secret_len).and_then(|key| {
            string_from_raw(event_id).and_then(|value| derive_nullifier(key, value))
        }),
    )
}

#[no_mangle]
pub extern "C" fn wallet_key_run_compatibility_self_test() -> *mut c_char {
    let result = (|| {
        let secret = Zeroizing::new(decode_hex(TEST_SECRET_HEX)?);
        let public = derive_public_material(&secret)?;
        let nullifier = derive_nullifier(&secret, TEST_EVENT_ID)?;
        let signature = sign_challenge(&secret, TEST_CHALLENGE_HEX)?;
        let public_material_matches = public.wallet_address == TEST_WALLET_ADDRESS;
        let nullifier_matches = nullifier == TEST_NULLIFIER;
        let signature_matches = signature == TEST_SIGNATURE;

        Ok(CompatibilityResult {
            passed: public_material_matches && nullifier_matches && signature_matches,
            public_material_matches,
            nullifier_matches,
            signature_matches,
        })
    })();
    response(result)
}

#[no_mangle]
/// # Safety
///
/// `value` must be null or a pointer returned by this library that has not
/// already been freed.
pub unsafe extern "C" fn wallet_key_string_free(value: *mut c_char) {
    if !value.is_null() {
        drop(CString::from_raw(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_current_typescript_wallet_vectors() {
        let secret = decode_hex(TEST_SECRET_HEX).unwrap();
        assert_eq!(
            derive_public_material(&secret).unwrap().wallet_address,
            TEST_WALLET_ADDRESS
        );
        assert_eq!(
            derive_nullifier(&secret, TEST_EVENT_ID).unwrap(),
            TEST_NULLIFIER
        );
        assert_eq!(
            sign_challenge(&secret, TEST_CHALLENGE_HEX).unwrap(),
            TEST_SIGNATURE
        );
    }
}
