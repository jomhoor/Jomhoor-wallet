module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: 'PassportVerification.podspec',
      },
      android: {
        sourceDir: './android',
        packageImportPath:
          'import com.iland.passportverification.PassportVerificationPackage;',
        packageInstance: 'new PassportVerificationPackage()',
      },
    },
  },
}
