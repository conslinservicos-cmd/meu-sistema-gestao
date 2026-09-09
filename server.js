const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });

// Banco de Dados SQLite
const db = new sqlite3.Database('./agendaboa.db', (err) => {
    if (!err) console.log("Banco SQLite conectado.");
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        telefone TEXT,
        email TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ordens_servico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER,
        descricao TEXT,
        valor REAL,
        status TEXT DEFAULT 'Pendente',
        data TEXT,
        FOREIGN KEY(cliente_id) REFERENCES clientes(id)
    )`);
});

// --- ROTAS CLIENTES ---
app.get('/api/clientes', (req, res) => {
    db.all("SELECT * FROM clientes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/clientes', (req, res) => {
    const { nome, telefone, email } = req.body;
    db.run("INSERT INTO clientes (nome, telefone, email) VALUES (?, ?, ?)", 
        [nome, telefone, email], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, nome, telefone, email });
        }
    );
});

// --- ROTAS ORDENS DE SERVIÇO ---
app.get('/api/ordens', (req, res) => {
    const query = `
        SELECT os.id, c.nome AS cliente, os.descricao, os.valor, os.status, os.data 
        FROM ordens_servico os 
        JOIN clientes c ON os.cliente_id = c.id
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/ordens', (req, res) => {
    const { cliente_id, descricao, valor, status, data } = req.body;
    db.run("INSERT INTO ordens_servico (cliente_id, descricao, valor, status, data) VALUES (?, ?, ?, ?, ?)", 
        [cliente_id, descricao, valor, status || 'Pendente', data || new Date().toISOString().split('T')[0]], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, cliente_id, descricao, valor, status, data });
        }
    );
});

// --- ROTA DE GERAR PDF DE RELATÓRIO COM FOTOS ---
app.post('/api/relatorios/pdf', upload.array('fotos', 10), async (req, res) => {
    try {
        const { titulo, cliente, local, data, observacoes, descricoesFotos } = req.body;

        const fotosProcessadas = (req.files || []).map((file, index) => {
            const bitmap = fs.readFileSync(file.path);
            const base64 = Buffer.from(bitmap).toString('base64');
            fs.unlinkSync(file.path);

            return {
                src: `data:${file.mimetype};base64,${base64}`,
                legenda: Array.isArray(descricoesFotos) ? descricoesFotos[index] : descricoesFotos || `Foto ${index + 1}`
            };
        });

        const dadosRelatorio = {
            empresa: {
                nome: "CONSLIN ENGENHARIA",
                subtitulo: "Laudos Técnicos & Inspeções Prediais",
                cnpj: "00.000.000/0001-00"
            },
            relatorio: {
                titulo: titulo || "Relatório de Inspeção Técnica",
                cliente: cliente || "Condomínio",
                local: local || "São Paulo / SP",
                data: data || new Date().toLocaleDateString('pt-BR'),
                observacoes: observacoes || "Sem observações."
            },
            fotos: fotosProcessadas
        };

        const html = await ejs.renderFile(path.join(__dirname, 'views', 'relatorio_fotografico.ejs'), dadosRelatorio);

        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' }
        });

        await browser.close();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=Relatorio_Fotografico.pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Erro ao gerar PDF:", error);
        res.status(500).send("Erro ao gerar PDF.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
