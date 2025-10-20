import Fastify from 'fastify';
import Config from '@/config';

const fastify = Fastify();

fastify.get('/', async () => {
    return { message: 'Hello, world!' };
});

const start = async () => {
    try {
        await fastify.listen({ port: Config.port, host: '0.0.0.0' });
        console.log(`Server is running on listening on port ${Config.port}.`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
