#ifndef WALLET_KEY_CRYPTO_H
#define WALLET_KEY_CRYPTO_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

char *wallet_key_public_material(const uint8_t *secret, size_t secret_len);
char *wallet_key_sign_challenge(
    const uint8_t *secret,
    size_t secret_len,
    const char *challenge_hex
);
char *wallet_key_derive_nullifier(
    const uint8_t *secret,
    size_t secret_len,
    const char *event_id
);
char *wallet_key_run_compatibility_self_test(void);
void wallet_key_string_free(char *value);

#ifdef __cplusplus
}
#endif

#endif
