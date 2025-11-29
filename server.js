const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Account, CreditLog, Payment } = require('./database');
const jalaali = require('jalaali-js');
const { v4: uuidv4 } = require('uuid');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const swaggerDocument = YAML.load('./swagger.yaml');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // سرو کردن دشبورد

// --- Helpers ---
const getJalaaliNow = () => {
    const d = new Date();
    const j = jalaali.toJalaali(d);
    // فرمت ساده YYYY/MM/DD HH:mm:ss
    return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')} ${d.toLocaleTimeString('en-GB')}`;
};

const responseOk = (res, data, msg = "عملیات با موفقیت انجام شد.") => {
    res.status(200).json({ message: msg, data: data });
};

const responseError = (res, code, msg) => {
    res.status(code).json({ message: msg });
};

app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
});


const API_PREFIX = '/v1/business/:business/ravand/provider/:provider';

app.post(`${API_PREFIX}/cardholder/:cardholder_id/credit/register`, async (req, res) => {
    const { cardholder_id } = req.params;
    const { credit_amount } = req.body;

    try {
        let account = await Account.findOne({ where: { cardholder_id } });
        if (account) {
            return responseError(res, 422, "کاربر قبلا ثبت شده است");
        }

        account = await Account.create({
            cardholder_id,
            credit_balance: credit_amount || 0,
            status: 'ACTIVE'
        });

        // ثبت لاگ اولیه اگر اعتباری داده شده
        if (credit_amount > 0) {
            await CreditLog.create({
                cardholder_id,
                credit_amount,
                type: 'CREDIT',
                adjusted_at: getJalaaliNow()
            });
        }

        responseOk(res, { credit_balance: account.credit_balance });
    } catch (e) {
        console.error(e);
        responseError(res, 500, "خطای داخلی");
    }
});

app.post(`${API_PREFIX}/cardholder/:cardholder_id/credit/adjustment`, async (req, res) => {
    const { cardholder_id } = req.params;
    const { credit_amount, type } = req.body;

    try {
        const account = await Account.findOne({ where: { cardholder_id } });
        if (!account) return responseError(res, 404, "کاربر یافت نشد");

        if (type === 'CREDIT') {
            account.credit_balance += credit_amount;
        } else if (type === 'DEBIT') {
            account.credit_balance -= credit_amount;
        } else {
            return responseError(res, 422, "نوع عملیات نامعتبر است (CREDIT/DEBIT)");
        }

        await account.save();
        await CreditLog.create({
            cardholder_id,
            credit_amount,
            type,
            adjusted_at: getJalaaliNow()
        });

        responseOk(res, { credit_balance: account.credit_balance });
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.post(`${API_PREFIX}/credit/adjustment`, async (req, res) => {
    const { credits } = req.body;

    const results = [];

    for (const item of credits || []) {
        try {
            const account = await Account.findOne({ where: { cardholder_id: item.cardholder_id } });
            if (!account) {
                results.push({ ...item, has_error: true, error: { message: "User not found" }, credit_balance: null });
                continue;
            }

            if (item.type === 'CREDIT') account.credit_balance += item.credit_amount;
            else if (item.type === 'DEBIT') account.credit_balance -= item.credit_amount;

            await account.save();
            await CreditLog.create({
                cardholder_id: item.cardholder_id,
                credit_amount: item.credit_amount,
                type: item.type,
                adjusted_at: getJalaaliNow()
            });

            results.push({
                ...item,
                has_error: false,
                credit_balance: account.credit_balance,
                error: null
            });

        } catch (e) {
            results.push({ ...item, has_error: true, error: { message: e.message }, credit_balance: null });
        }
    }

    responseOk(res, results);
});

app.get(`${API_PREFIX}/credit/account`, async (req, res) => {
    try {
        const accounts = await Account.findAll();
        const responseList = accounts.map(acc => ({
            cardholder_id: acc.cardholder_id,
            account: {
                account_number: acc.account_number,
                balance: acc.balance
            },
            credit: {
                status: acc.status,
                balance: acc.credit_balance
            }
        }));

        responseOk(res, { has_more: false, accounts: responseList }, "اطلاعات با موفقیت دریافت شد.");
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.get(`${API_PREFIX}/cardholder/:cardholder_id/credit`, async (req, res) => {
    const { cardholder_id } = req.params;
    try {
        const logs = await CreditLog.findAll({ where: { cardholder_id }, order: [['createdAt', 'DESC']] });
        responseOk(res, {
            has_more: false,
            credits: logs.map(l => ({
                cardholder_id: l.cardholder_id,
                credit_amount: l.credit_amount,
                type: l.type,
                adjusted_at: l.adjusted_at
            }))
        }, "اطلاعات با موفقیت دریافت شد.");
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.get(`${API_PREFIX}/credit`, async (req, res) => {
    try {
        const logs = await CreditLog.findAll({ order: [['createdAt', 'DESC']], limit: 50 });
        responseOk(res, {
            has_more: false,
            credits: logs.map(l => ({
                cardholder_id: l.cardholder_id,
                credit_amount: l.credit_amount,
                type: l.type,
                adjusted_at: l.adjusted_at
            }))
        }, "اطلاعات با موفقیت دریافت شد.");
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.put(`${API_PREFIX}/cardholder/:cardholder_id/credit/update-status`, async (req, res) => {
    const { cardholder_id } = req.params;
    const { status } = req.body; // ACTIVE or INACTIVE

    try {
        const account = await Account.findOne({ where: { cardholder_id } });
        if (!account) return responseError(res, 404, "یافت نشد");

        account.status = status;
        await account.save();
        responseOk(res, { status: account.status });
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.get(`${API_PREFIX}/cardholder/:cardholder_id/credit/payment`, async (req, res) => {
    const { cardholder_id } = req.params;
    try {
        const payments = await Payment.findAll({ where: { cardholder_id } });
        const account = await Account.findOne({ where: { cardholder_id } });

        responseOk(res, {
            has_more: false,
            payments: payments.map(p => ({
                cardholder_id: p.cardholder_id,
                account_number: account ? account.account_number : "N/A",
                credit_source_account_number: "101310810707074987", // استاتیک طبق مثال
                amount: p.amount,
                pay_id: p.pay_id,
                paid_at: p.paid_at,
                repaid_at: null,
                review_date: "1404/02/17", // دامی
                settled: p.settled
            }))
        }, "اطلاعات با موفقیت دریافت شد.");
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.get(`${API_PREFIX}/credit/payment`, async (req, res) => {
    try {
        const payments = await Payment.findAll();
        responseOk(res, {
            has_more: false,
            payments: payments.map(p => ({
                cardholder_id: p.cardholder_id,
                amount: p.amount,
                pay_id: p.pay_id,
                paid_at: p.paid_at,
                settled: p.settled
            }))
        }, "اطلاعات با موفقیت دریافت شد.");
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.post('/api/debug/simulate-payment', async (req, res) => {
    const { cardholder_id, amount } = req.body;
    try {
        const account = await Account.findOne({ where: { cardholder_id } });
        if (!account) return responseError(res, 404, "User not found");

        if (account.credit_balance < amount) return responseError(res, 400, "اعتبار کافی نیست");

        account.credit_balance -= amount;
        await account.save();

        await Payment.create({
            cardholder_id,
            amount,
            pay_id: uuidv4(),
            paid_at: getJalaaliNow(),
            settled: false
        });

        await CreditLog.create({
            cardholder_id,
            credit_amount: amount,
            type: 'DEBIT',
            adjusted_at: getJalaaliNow()
        });

        responseOk(res, { new_balance: account.credit_balance }, "پرداخت تستی انجام شد");
    } catch (e) {
        responseError(res, 500, e.message);
    }
});

app.listen(PORT, () => {
    console.log(`Mock Server running on http://localhost:${PORT}`);
    console.log(`Dashboard available at http://localhost:${PORT}`);
});