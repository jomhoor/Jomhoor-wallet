module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: 'NidVerification.podspec',
      },
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.iland.nidverification.NidVerificationPackage;',
        packageInstance: 'new NidVerificationPackage()',
      },
    },
  },
}
