#pragma once

#include <openssl/ssl.h>

#include <openssl/aes.h>
#include <openssl/asn1.h>
#include <openssl/asn1t.h>
#include <openssl/bio.h>
#include <openssl/bn.h>
#include <openssl/cmac.h>
#include <openssl/cms.h>
#include <openssl/crypto.h>
#include <openssl/dh.h>
#include <openssl/ec.h>
#include <openssl/ecdsa.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/obj_mac.h>
#include <openssl/objects.h>
#include <openssl/pem.h>
#include <openssl/pkcs7.h>
#include <openssl/rand.h>
#include <openssl/rsa.h>
#include <openssl/x509.h>
#include <openssl/x509_vfy.h>
#include <openssl/x509v3.h>

#ifdef __cplusplus
extern "C" {
#endif

int OpenSSLLocal_sk_X509_num(const OPENSSL_STACK *stack);
X509 *OpenSSLLocal_sk_X509_value(const OPENSSL_STACK *stack, int index);

#ifdef __cplusplus
}
#endif
