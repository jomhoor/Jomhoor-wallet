#import "OpenSSLLocal.h"

int OpenSSLLocal_sk_X509_num(const OPENSSL_STACK *stack) {
    return OPENSSL_sk_num(stack);
}

X509 *OpenSSLLocal_sk_X509_value(const OPENSSL_STACK *stack, int index) {
    return (X509 *)OPENSSL_sk_value(stack, index);
}

void OpenSSLLocalShim(void) {}
