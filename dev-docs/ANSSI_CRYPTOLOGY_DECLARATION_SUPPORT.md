# Annexe technique - Déclaration d'un moyen de cryptologie

Date du dossier : 10 juin 2026  
Produit : Jomhoor  
Version du produit : `0.5.34`  
Identifiant iOS : `org.jomhoor.app`  
Identifiant Android : `org.jomhoor.app`  
Mode de distribution : application mobile distribuée par des boutiques
d'applications, notamment l'Apple App Store

## 1. Identification du déclarant

Les informations juridiques suivantes ne figurent pas dans le dépôt logiciel
et doivent être renseignées par le déclarant :

| Champ                         | Valeur                |
| ----------------------------- | --------------------- |
| Raison sociale du fournisseur | `[À COMPLÉTER]`       |
| Forme juridique               | `[À COMPLÉTER]`       |
| Adresse du siège social       | `[À COMPLÉTER]`       |
| Pays d'établissement          | `[À COMPLÉTER]`       |
| Numéro d'immatriculation      | `[À COMPLÉTER]`       |
| Nom du représentant habilité  | `[À COMPLÉTER]`       |
| Fonction du représentant      | `[À COMPLÉTER]`       |
| Contact technique             | `[À COMPLÉTER]`       |
| Adresse électronique          | `[À COMPLÉTER]`       |
| Numéro de téléphone           | `[À COMPLÉTER]`       |
| Site internet du produit      | `https://jomhoor.org` |

## 2. Objet de la déclaration

Le déclarant souhaite effectuer les formalités applicables à la fourniture en
France du moyen de cryptologie dénommé **Jomhoor**.

Jomhoor est un produit logiciel grand public distribué sous la forme d'une
application mobile. Les fonctions cryptographiques sont intégrées au produit et
ne sont pas proposées comme un service autonome de chiffrement.

Le déclarant sollicite :

- l'enregistrement de la déclaration relative à la fourniture du produit en
  France ;
- l'indication du régime réglementaire applicable au produit ;
- l'examen de son éventuelle éligibilité au classement « grand public » ;
- la délivrance du récépissé, de l'accusé d'enregistrement, de la décision de
  classement ou de tout document officiel correspondant à la formalité
  applicable.

Si le déclarant importe lui-même le produit en France ou réalise d'autres
opérations réglementées, les cases correspondantes doivent également être
sélectionnées dans le formulaire officiel.

## 3. Identification du produit

| Élément                                                  | Description                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Nom commercial                                           | Jomhoor                                                      |
| Nature                                                   | Application mobile iOS et Android                            |
| Version examinée                                         | `0.5.34`                                                     |
| Identifiant iOS                                          | `org.jomhoor.app`                                            |
| Identifiant Android                                      | `org.jomhoor.app`                                            |
| Éditeur/fournisseur                                      | `[À COMPLÉTER]`                                              |
| Origine du logiciel                                      | Développement applicatif et composants open source ou tiers  |
| Utilisateurs visés                                       | Grand public                                                 |
| Distribution                                             | Boutiques d'applications mobiles et canaux de test autorisés |
| Administration à distance des fonctions cryptographiques | Non                                                          |
| Sélection d'algorithmes par l'utilisateur                | Non                                                          |
| Fonction de cryptanalyse                                 | Non                                                          |

## 4. Description fonctionnelle

Jomhoor est une application de portefeuille d'identité numérique, de
vérification de documents et de participation civique. Elle permet à
l'utilisateur de :

- créer ou importer un portefeuille cryptographique contrôlé localement ;
- lire des documents d'identité électroniques compatibles au moyen de la
  technologie NFC ;
- vérifier l'intégrité et l'authenticité des données d'un document ;
- effectuer une vérification biométrique locale ;
- générer des preuves cryptographiques d'identité ou d'éligibilité ;
- s'authentifier auprès de services compatibles ;
- signer des messages et des transactions blockchain ;
- participer à des consultations ou propositions soumises à des conditions
  d'identité.

L'application n'est pas un outil de chiffrement généraliste. Elle ne fournit
pas de chiffrement arbitraire de fichiers, de messagerie chiffrée, de VPN, de
proxy, de cryptanalyse ou de service de gestion de clés pour des tiers.

## 5. Fonctions cryptographiques

### 5.1 Lecture sécurisée de documents électroniques

L'application lit des passeports électroniques compatibles avec la norme ICAO
Doc 9303. Elle établit un canal temporaire protégé entre le téléphone et la puce
du document.

Protocoles pris en charge :

- Basic Access Control (BAC)
- Password Authenticated Connection Establishment (PACE)
- messagerie sécurisée ICAO
- authentification passive
- authentification active
- authentification de la puce

Algorithmes et mécanismes :

| Mécanisme                      | Paramètres principaux                                              | Usage                                                                |
| ------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Triple DES                     | EDE à deux clés, mode CBC                                          | Authentification BAC et messagerie sécurisée des profils historiques |
| AES                            | Clés de 128, 192 ou 256 bits ; modes CBC et ECB selon le protocole | PACE et messagerie sécurisée ICAO                                    |
| ISO/IEC 9797-1 MAC Algorithm 3 | Retail MAC fondé sur DES                                           | Intégrité et authentification BAC                                    |
| AES-CMAC                       | Clés dérivées de session                                           | Intégrité et authentification des profils AES                        |
| Diffie-Hellman                 | Groupes définis par le document                                    | Accord de clés PACE et authentification de la puce                   |
| ECDH                           | Courbes définies par le document                                   | Accord de clés PACE et authentification de la puce                   |
| SHA-1 et SHA-256               | Dérivation conforme au profil ICAO                                 | Dérivation des clés d'accès et de session                            |

Les clés de session sont dérivées ou négociées pour une session NFC. Elles ne
sont pas conservées comme identifiants permanents.

### 5.2 Authentification des documents

L'application vérifie les empreintes, certificats et signatures intégrés aux
documents électroniques.

Algorithmes traités :

- SHA-1, SHA-224, SHA-256, SHA-384 et SHA-512
- RSA PKCS#1 v1.5
- RSA-PSS
- ECDSA
- certificats X.509
- données signées CMS/PKCS#7
- courbes NIST P-192, P-224, P-256, P-384 et P-521
- courbes Brainpool P-256, P-320, P-384 et P-512

Ces fonctions servent à vérifier l'intégrité des groupes de données, les
signatures du document et, lorsqu'elles sont disponibles, les fonctions
d'authentification active ou d'authentification de la puce.

### 5.3 Portefeuille cryptographique local

Le produit génère localement une valeur privée de 256 bits ou permet à
l'utilisateur d'importer une clé. La clé est stockée sur iOS dans le trousseau
Keychain au moyen d'Expo SecureStore.

Le portefeuille d'identité utilise :

- la courbe Baby Jubjub ;
- la fonction de hachage Poseidon sur le corps BN254 ;
- une signature de défi de type EdDSA sur Baby Jubjub avec hachage Poseidon.

Ces mécanismes servent à dériver l'identifiant du portefeuille, signer des
défis d'authentification et produire des engagements ou nullifiants. Ils ne
servent pas au chiffrement de contenus utilisateur.

### 5.4 Compatibilité blockchain EVM

Le produit utilise :

- ECDSA sur secp256k1 ;
- Keccak-256 ;
- la dérivation d'adresses compatibles Ethereum ;
- la signature de messages et de transactions compatibles Ethereum.

Les opérations de signature sont réalisées localement. La clé privée n'est pas
destinée à être transmise aux services applicatifs.

### 5.5 Preuves à divulgation nulle de connaissance

Le produit génère localement des preuves cryptographiques permettant de
démontrer une propriété sans divulguer l'ensemble des données privées.

Mécanismes utilisés :

- Groth16 avec Rapidsnark ;
- Noir PLONK/UltraPLONK avec le moteur Swoirenberg ;
- opérations sur le corps et les appariements BN254 ;
- engagements, nullifiants et arbres de Merkle utilisant Poseidon.

Les preuves sont utilisées pour démontrer notamment :

- la possession d'une clé privée ;
- la validité de données issues d'un document d'identité ;
- la possession d'une identité enregistrée ;
- le respect de critères d'âge, de nationalité ou d'éligibilité ;
- l'unicité d'une participation au moyen d'un nullifiant contextuel.

Ces mécanismes produisent des preuves et des signaux publics. Ils ne fournissent
pas un service de chiffrement de fichiers ou de communications.

### 5.6 Communications réseau et services Apple

Le produit utilise également :

- HTTPS/TLS fourni par les bibliothèques réseau du système d'exploitation ;
- le trousseau iOS Keychain pour le stockage de la clé privée ;
- la génération aléatoire sécurisée exposée par l'environnement d'exécution ;
- Local Authentication et Face ID pour le contrôle d'accès local ;
- Apple App Attest pour l'attestation d'intégrité de l'application.

Le produit ne met pas en œuvre de protocole TLS propriétaire.

## 6. Tableau récapitulatif des algorithmes

| Famille                                     | Algorithmes ou mécanismes                                  | Finalité                                                     |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Chiffrement symétrique                      | Triple DES, AES-128/192/256                                | Canal NFC sécurisé avec un document électronique             |
| Authentification symétrique                 | Retail MAC ISO/IEC 9797-1, AES-CMAC, CBC-MAC fondé sur DES | Intégrité des échanges NFC                                   |
| Accord de clés                              | DH, ECDH                                                   | PACE et authentification de la puce                          |
| Hachage standard                            | SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, Keccak-256      | Documents, signatures, blockchain et préparation de preuves  |
| Signature standard                          | RSA PKCS#1 v1.5, RSA-PSS, ECDSA, ECDSA/secp256k1           | Authentification des documents, messages et transactions     |
| Courbes de documents                        | NIST P-192/224/256/384/521, Brainpool P-256/320/384/512    | Vérification et accord de clés pour documents électroniques  |
| Cryptographie adaptée aux preuves           | Poseidon, Baby Jubjub, BN254                               | Identifiants, signatures de défi, engagements et nullifiants |
| Preuves à divulgation nulle de connaissance | Groth16, PLONK, UltraPLONK                                 | Preuves locales d'identité et d'éligibilité                  |

## 7. Gestion des clés

### 7.1 Clé du portefeuille

- Génération locale ou importation explicite par l'utilisateur.
- Longueur stockée : 256 bits.
- Stockage iOS : Keychain par l'intermédiaire d'Expo SecureStore.
- Utilisation : dérivation d'identifiants, signatures, transactions et entrées
  privées de preuves.
- Transmission vers les services Jomhoor : aucune transmission intentionnelle
  de la clé privée.
- Séquestre ou récupération serveur : non.

### 7.2 Clés des documents électroniques

- Clés BAC dérivées des données de la zone de lecture automatique.
- Clés PACE ou Chip Authentication dérivées d'un accord de clés éphémère.
- Clés de chiffrement et de MAC limitées à une session NFC.
- Absence de conservation comme clés permanentes.

### 7.3 Paramètres de preuve

Les circuits, clés de preuve et chaînes de référence structurées sont des
paramètres publics. Ils peuvent être intégrés à l'application ou téléchargés
par HTTPS. Ils ne contiennent pas les clés privées de l'utilisateur.

## 8. Données protégées ou authentifiées

Les mécanismes cryptographiques protègent ou authentifient :

- la propriété du portefeuille ;
- les défis d'authentification ;
- les messages et transactions blockchain ;
- les échanges NFC avec les documents électroniques ;
- l'intégrité et l'authenticité des données du document ;
- les engagements d'identité et nullifiants ;
- les assertions d'identité ou d'éligibilité ;
- la clé privée stockée dans le Keychain ;
- les communications réseau transportées par HTTPS/TLS.

## 9. Composants cryptographiques

Les principaux composants utilisés sont :

- OpenSSL 3.5.5 intégré pour iOS
- NFCPassportReader
- `@iden3/js-crypto`
- `@noble/curves`
- `@noble/hashes`
- `ethers`
- `crypto-browserify`
- `create-hash`
- `des.js`
- Rapidsnark
- Noir/Swoirenberg
- bibliothèques natives de calcul de témoins
- Expo SecureStore

L'inclusion d'une bibliothèque générique ne signifie pas que tous les
algorithmes qu'elle contient sont activement utilisés. Le présent dossier
décrit les fonctions identifiées dans les chemins d'exécution du produit.

## 10. Limites fonctionnelles

Le produit ne fournit pas :

- de chiffrement général de fichiers ou de disques ;
- de messagerie chiffrée entre utilisateurs ;
- de VPN, tunnel ou proxy ;
- de service de séquestre de clés ;
- de gestion de clés pour le compte de tiers ;
- d'algorithmes définis par l'utilisateur ;
- de fonctions de cryptanalyse.

## 11. Origine et maintenance

Le produit est constitué de code applicatif Jomhoor et de composants open source
ou tiers. Les mises à jour sont distribuées par les canaux de distribution de
l'application. Les modifications importantes des fonctions cryptographiques
doivent faire l'objet d'une réévaluation du présent dossier et des formalités
applicables.

## 12. Attestation du déclarant

```text
Je soussigné(e), [NOM ET PRÉNOM], agissant en qualité de [FONCTION] pour le
compte de [RAISON SOCIALE], certifie que les informations contenues dans la
présente annexe technique sont exactes à la date du 10 juin 2026.

Fait à : [LIEU]
Le : [DATE]

Nom :
Fonction :
Signature :
```

## 13. Référence réglementaire

Formulaire ANSSI :

**Déclaration et demande d'autorisation d'opérations relatives à un moyen de
cryptologie**

<https://cyber.gouv.fr/documents/330/crypto_declaration-demande_autorisation_operations_annexe1_v2.pdf>

Instructions de transmission :

<https://cyber.gouv.fr/reglementation/reglementation-identite-confiance-numerique/controles-reglementaires-cryptographie/controle-moyen-de-cryptologie/controle-reglementaire-cryptographie-formulaires/>
