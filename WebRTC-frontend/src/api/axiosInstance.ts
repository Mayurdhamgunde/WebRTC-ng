import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000'; // Match your backend URL

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default axiosInstance;
