import { PrimaryButton } from '@/components/button';
import { TextInput } from '@/components/textInput';
import { Tile } from '@/components/tile';
import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

// 1. Define your schema with Zod
const formSchema = z.object({
    email: z.email({ error: 'Invalid email address' }),
    password: z.string({ error: 'Required' }).min(8, { error: 'Password must be at least 8 characters' }),
});

// 2. Infer the type from the schema
type FormData = z.infer<typeof formSchema>;

export function ExampleForm() {
    // 3. Set up the form with zodResolver
    const {
        control,
        handleSubmit,
        formState: { isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: '',
            password: '',
        },
    });

    // 4. Handle form submission
    const onSubmit = (data: FormData) => {
        console.log('Form submitted:', data);
        // Handle your form submission here
    };

    return (
        <Tile className='w-[400px] self-center'>
            <TextInput
                name='email'
                control={control}
                label='Email'
                placeholder='Enter your email'
                keyboardType='email-address'
            />

            <TextInput
                name='password'
                control={control}
                label='Password'
                placeholder='Enter your password'
                secureTextEntry
            />

            <PrimaryButton
                text={isSubmitting ? 'Submitting...' : 'Submit'}
                onPress={handleSubmit(onSubmit)}
                isDisabled={isSubmitting}
            />
        </Tile>
    );
}
