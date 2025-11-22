[![Made with JavaScript](https://img.shields.io/badge/Made%20with-JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Postman](https://img.shields.io/badge/Postman-FF6C37?style=for-the-badge&logo=postman&logoColor=white)


## This project is a Secure Multi-File Upload & Processing System built using Node.js + Express, supporting:

- Encrypted file storage (AES-256-CBC)
- Dynamic folder creation based on date + username
- CSV & Excel parsing and database storage
- Secure audio/video upload
- Encrypted media streaming (audio/video)
- Grouped user-based data retrieval
- Update and delete operations for stored records


1. Clone the repository:

```sh
git clone https://github.com/Bala2516/filehub-api.git
cd file-upload
```

2. Install dependencies:

```sh
npm install
```

3. Set up .env file:

```sh
AES_SECRET_KEY=your_key
```
- Generate key, open command prompt 

```sh
run this
node
```


### Running the Server

```sh
npm start
```

Server will start on http://localhost:3000