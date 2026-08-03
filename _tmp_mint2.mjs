import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
config();
console.log(jwt.sign({ sub: 42, principal: 'user', userType: 'service_provider' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '1h' }));
