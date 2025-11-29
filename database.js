const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'data', 'database.sqlite'),
    logging: false
});

const Account = sequelize.define('Account', {
    cardholder_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true
    },
    account_number: {
        type: DataTypes.STRING,
        defaultValue: () => '1013' + Math.floor(Math.random() * 100000000000000)
    },
    balance: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    credit_balance: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    status: {
        type: DataTypes.ENUM('ACTIVE', 'INACTIVE'),
        defaultValue: 'ACTIVE'
    }
});

const CreditLog = sequelize.define('CreditLog', {
    cardholder_id: DataTypes.UUID,
    credit_amount: DataTypes.INTEGER,
    type: DataTypes.STRING,
    adjusted_at: DataTypes.STRING
});

const Payment = sequelize.define('Payment', {
    cardholder_id: DataTypes.UUID,
    pay_id: DataTypes.STRING,
    amount: DataTypes.INTEGER,
    paid_at: DataTypes.STRING,
    settled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

sequelize.sync().then(() => {
    console.log('Database & tables created!');
});

module.exports = { sequelize, Account, CreditLog, Payment };